import { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut } from 'electron';
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { TccDBusController } from '../common/classes/TccDBusController';

// Tweak to get correct dirname for resource files outside app.asar
const appPath = __dirname.replace('app.asar/', '');

const autostartLocation = path.join(os.homedir(), '.config/autostart');
const autostartDesktopFilename = 'tuxedo-control-center-tray.desktop';
const tccConfigDir = '.tcc';
const startTCCAccelerator = 'Super+Alt+F6';

let tccWindow: Electron.BrowserWindow;
let tray: Electron.Tray;
let tccDBus: TccDBusController;

const watchOption = process.argv.includes('--watch');
const trayOnlyOption = process.argv.includes('--tray');
const noTccdVersionCheck = process.argv.includes('--no-tccd-version-check');

// Ensure that only one instance of the application is running
const applicationLock = app.requestSingleInstanceLock();
if (!applicationLock) {
    console.log('TUXEDO Control Center is already running');
    app.exit(0);
}

if (watchOption) {
    require('electron-reload')(path.join(__dirname, '..', 'ng-app'));
}

if (isFirstStart()) {
    installAutostartTray();
}

if (!userConfigDirExists()) {
    createUserConfigDir();
}

app.on('second-instance', (event, cmdLine, workingDir) => {
    // If triggered by a second instance, find/show/start GUI
    activateTccGui();
});

app.whenReady().then( () => {
    const success = globalShortcut.register(startTCCAccelerator, () => {
        activateTccGui();
    });
    if (!success) { console.log('Failed to register global shortcut'); }

    createTccTray();
    if (!trayOnlyOption) {
        activateTccGui();
    }

    if (!noTccdVersionCheck) {
        // Regularly check if running tccd version is different to running gui version
        const tccdVersionCheckInterval = 5000;
        setInterval(async () => {
            if (tccDBus === undefined) {
                tccDBus = new TccDBusController();
                await tccDBus.init();
            } else if (!await tccDBus.dbusAvailable()) {
                await tccDBus.init();
            }

            if (await tccDBus.tuxedoWmiAvailable()) {
                const tccdVersion = await tccDBus.tccdVersion();
                if (tccdVersion.length > 0 && tccdVersion !== app.getVersion()) {
                    console.log('Other tccd version detected, restarting..');
                    app.relaunch({ args: process.argv.slice(1).concat(['--tray']) });
                    app.exit(0);
                }
            }

        }, tccdVersionCheckInterval);
    }
});

app.on('will-quit', (event) => {
    // Prevent default quit action
    event.preventDefault();

    // Close window but do not quit application unless tray is gone
    if (tccWindow) {
        tccWindow.close();
        tccWindow = null;
    }
    if (!tray || tray.isDestroyed()) {
        // Actually quit
        globalShortcut.unregisterAll();
        app.exit(0);
    }
});

app.on('window-all-closed', () => {
    if (!tray || tray.isDestroyed()) {
        quitCurrentTccSession();
    }
});

function activateTccGui() {
    if (tccWindow) {
        if (tccWindow.isMinimized()) { tccWindow.restore(); }
        tccWindow.focus();
    } else {
        createTccWindow();
    }
}

function createTccTray() {
    const trayInstalled = isAutostartTrayInstalled();
    const trayIcon =  path.join(__dirname, '../../data/dist-data/tuxedo-control-center_256.png');
    if (!tray) {
        tray = new Tray(trayIcon);
        tray.setTitle('TUXEDO Control Center');
        tray.setToolTip('TUXEDO Control Center');
    }
    const contextMenu = Menu.buildFromTemplate([
        { label: 'TUXEDO Control Center', type: 'normal', click: () => { activateTccGui(); }, },
        {
                label: 'Tray autostart', type: 'checkbox', checked: trayInstalled,
                click: () => trayInstalled ? menuRemoveAutostartTray() : menuInstallAutostartTray()
        },
        { type: 'separator' },
        { label: 'v' + app.getVersion(), type: 'normal', enabled: false },
        { type: 'separator' },
        { label: 'Exit', type: 'normal', click: () => { quitCurrentTccSession(); } }
    ]);
    tray.setContextMenu(contextMenu);
}

function menuInstallAutostartTray() {
    installAutostartTray();
    createTccTray();
}

function menuRemoveAutostartTray() {
    removeAutostartTray();
    createTccTray();
}

function createTccWindow() {
    tccWindow = new BrowserWindow({
        title: 'TUXEDO Control Center',
        width: 1040,
        height: 750,
        frame: false,
        resizable: true,
        minWidth: 1040,
        minHeight: 750,
        icon: path.join(__dirname, '../../data/dist-data/tuxedo-control-center_256.png'),
        webPreferences: {
            nodeIntegration: true
        }
    });

    const indexPath = path.join(__dirname, '..', '..', 'ng-app', 'index.html');
    tccWindow.loadFile(indexPath);
    tccWindow.on('closed', () => {
        tccWindow = null;
    });
}

function quitCurrentTccSession() {
    if (tray) {
        tray.destroy();
        tray = null;
    }

    app.quit();
}

ipcMain.on('exec-cmd-sync', (event, arg) => {
    try {
        event.returnValue = { data: child_process.execSync(arg), error: undefined };
    } catch (err) {
        event.returnValue = { data: undefined, error: err };
    }
});

ipcMain.on('exec-cmd-async', (event, arg) => {
    child_process.exec(arg, (err, stdout, stderr) => {
        if (err) {
            event.reply('exec-cmd-result', { data: stderr, error: err });
        } else {
            event.reply('exec-cmd-result', { data: stdout, error: err });
        }
    });
});

ipcMain.on('spawn-external-async', (event, arg) => {
    child_process.spawn(arg, { detached: true, stdio: 'ignore' });
});

function installAutostartTray(): boolean {
    try {
        fs.copyFileSync(
            path.join(appPath, '../../data/dist-data', autostartDesktopFilename),
            path.join(autostartLocation, autostartDesktopFilename)
        );
        return true;
    } catch (err) {
        console.log('Failed to install autostart tray -> ' + err);
        return false;
    }
}

function removeAutostartTray(): boolean {
    try {
        if (fs.existsSync(path.join(autostartLocation, autostartDesktopFilename))) {
            fs.unlinkSync(path.join(autostartLocation, autostartDesktopFilename));
        }
        return true;
    } catch (err) {
        console.log('Failed to remove autostart tray -> ' + err);
        return false;
    }
}

function isAutostartTrayInstalled(): boolean {
    try {
        return fs.existsSync(path.join(autostartLocation, autostartDesktopFilename));
    } catch (err) {
        console.log('Failed to check if autostart tray is installed -> ' + err);
        return false;
    }
}

function isFirstStart(): boolean {
    return !userConfigDirExists();
}

function userConfigDirExists(): boolean {
    try {
        return fs.existsSync(path.join(os.homedir(), '.tcc'));
    } catch (err) {
        return false;
    }
}

function createUserConfigDir(): boolean {
    try {
        fs.mkdirSync(path.join(os.homedir(), '.tcc'));
        return true;
    } catch (err) {
        return false;
    }
}
