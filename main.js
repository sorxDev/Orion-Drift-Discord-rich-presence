const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs   = require('fs');
const CONFIG_DIR  = path.join(app.getPath('userData'), 'a2-presence');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}
function saveConfig(cfg) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

let config = loadConfig();

// Discord RPC
let RPC, rpcClient, discordProfile = {};
let selectedStation = null, startTimestamp = new Date();
let presenceEnabled = true;

async function initRPC() {
  try {
    RPC = require('discord-rpc');
    RPC.register('1498713834242965725');
    rpcClient = new RPC.Client({ transport: 'ipc' });

    rpcClient.on('ready', () => {
      const u = rpcClient.user;
      const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith('a_')?'gif':'png'}?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(u.discriminator||0)%5}.png`;
      discordProfile = {
        username:    u.username || u.global_name || '',
        avatarUrl:   avatar,
        bannerColor: u.banner_color || u.bannerColor || null,
        bio:         u.bio || null,
      };
      console.log('Discord connected:', discordProfile.username);
      if (win) win.webContents.send('discord-status', { connected: true, ...discordProfile });
      if (selectedStation && presenceEnabled) updatePresence();
    });

    rpcClient.on('disconnected', () => {
      discordProfile = {};
      if (win) win.webContents.send('discord-status', { connected: false });
      setTimeout(initRPC, 15000);
    });

    await rpcClient.login({ clientId: '1498713834242965725' });
  } catch(e) {
    console.error('RPC connect failed:', e.message);
    if (win) win.webContents.send('discord-status', { connected: false, error: e.message });
    setTimeout(initRPC, 15000);
  }
}

// field helpers
const getName     = s => s.station_name || s.name || 'Unknown';
const getPlayers  = s => parseInt(s.player_count ?? 0) || 0;
const getMax      = s => 0; 
const getRegion   = s => s.region || '';
const getFleet    = s => { const v = s.fleet||s.fleetName||s.fleet_name||s.fleetLabel||s.fleet_label||s.group||s.category||s.type||''; return (v && v.length < 30) ? v : ''; };
const getId       = s => s.station_id || s.id || (s.station_name||s.name||'');
const getLogo     = s => s.config?.logo || null;
const getFleetIcon=s=>s.config?.logo??null; 
const getIcon   =s=>fv(s,'image','imageUrl','image_url','icon','iconUrl','icon_url','logo','thumbnail','picture','img')??null;

async function updatePresence() {
  if (!rpcClient || !selectedStation || !presenceEnabled) {
    if (rpcClient && !presenceEnabled) rpcClient.clearActivity().catch(()=>{});
    return;
  }
  const name    = getName(selectedStation);
  const players = getPlayers(selectedStation);
  const max     = getMax(selectedStation);
  const region  = getRegion(selectedStation);
  const fleet   = getFleet(selectedStation);
  const logo    = getLogo(selectedStation);
  const state   = max ? `${players} / ${max} players` : `${players} players online`;

  await rpcClient.setActivity({
    details:        name,
    state:          `${players} players online`,
    startTimestamp,
    largeImageKey:  'station_logo',
    largeImageText: 'Orion Drift',
    smallImageKey:  logo ?? 'station_icon',
    smallImageText: fleet ? fleet + ' Fleet' : name,
    instance:       false,
  }).catch(e => console.error('setActivity:', e.message));
  console.log(`Presence: ${name} — ${state}`);
}

// IPC handlers
ipcMain.handle('get-config', () => ({
  hasApiKey: !!config.apiKey,
  apiKey:    config.apiKey || '',
  discordProfile,
}));

ipcMain.handle('save-api-key', (_, key) => {
  config.apiKey = key.trim();
  saveConfig(config);
  return { ok: true };
});

ipcMain.handle('clear-api-key', () => {
  config.apiKey = '';
  saveConfig(config);
  return { ok: true };
});

ipcMain.handle('select-station', async (_, station) => {
  if (!station) return { ok: false, error: 'No station provided' };
  selectedStation = station;
  startTimestamp  = new Date();
  if (presenceEnabled) {
    try { await updatePresence(); }
    catch(e) { console.error('updatePresence error:', e.message); }
  }
  return { ok: true };
});

ipcMain.handle('toggle-presence', (_, enabled) => {
  presenceEnabled = enabled;
  if (!enabled && rpcClient) rpcClient.clearActivity().catch(()=>{});
  else if (enabled && selectedStation) updatePresence();
  return { ok: true };
});

ipcMain.handle('get-presence-state', () => ({
  connected:      !!rpcClient && !!discordProfile.username,
  presenceEnabled,
  selectedId:     selectedStation ? getId(selectedStation) : null,
  selectedName:   selectedStation ? getName(selectedStation) : null,
  players:        selectedStation ? getPlayers(selectedStation) : null,
  max:            selectedStation ? getMax(selectedStation) : null,
  ...discordProfile,
}));

ipcMain.handle('update-presence-data', (_, station) => {
  if (selectedStation && station && getId(station) === getId(selectedStation)) {
    selectedStation = station;
    if (presenceEnabled) updatePresence();
  }
  return { ok: true };
});

// Window
let win;
function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const indexPath   = path.join(__dirname, 'ui', 'index.html');
  const iconPath    = path.join(__dirname, 'assets', 'icon.png');

  win = new BrowserWindow({
    width: 1200, height: 750,
    minWidth: 800, minHeight: 500,
    backgroundColor: '#000000',
    title: 'A2 Station Presence',
    icon: iconPath,
    webPreferences: {
      preload:          preloadPath,
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,
    },
  });
  win.loadFile(indexPath);
  win.setMenuBarVisibility(false);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  initRPC();
  // poll presence refresh every 15s
  setInterval(() => { if (selectedStation && presenceEnabled) updatePresence(); }, 15000);
});

app.on('window-all-closed', () => {
  if (rpcClient) rpcClient.destroy().catch(()=>{});
  app.quit();
});
