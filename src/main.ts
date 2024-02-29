import {
  Plugin,
  WorkspacePluginInstance,
  setIcon,
  Notice,
  debounce,
  normalizePath,
  TFile,
  MarkdownView,
} from "obsidian";
import { WorkspacesPlusSettings, WorkspacesPlusSettingsTab, DEFAULT_SETTINGS } from "./settings";
import { WorkspacesPlusPluginWorkspaceModal } from "./workspaceModal";
import { WorkspacesPlusPluginModeModal } from "./modeModal";
import { around } from "monkey-around";
import Utils from "./utils";

export default class WorkspacesPlus extends Plugin {
  settings: WorkspacesPlusSettings;
  workspacePlugin: WorkspacePluginInstance;
  debug: boolean;
  workspaceLoading: boolean;
  statusBarWorkspace: HTMLElement;
  statusBarMode: HTMLElement;
  ribbonIconMode: HTMLElement;
  ribbonIconWorkspaces: HTMLElement;
  nativeWorkspaceRibbonItem: HTMLElement;
  isNativePluginEnabled: boolean;
  utils: Utils;

  async onload() {
    this.debug = false;
    // load settings
    await this.loadSettings();
    this.utils = new Utils(this);
    this.workspacePlugin = this.utils.workspacePlugin;
    this.isNativePluginEnabled = this.utils.isNativePluginEnabled;
    this.installWorkspaceHooks();
    this.registerEvent(
      this.app.internalPlugins.on("change", plugin => {
        if (plugin?.instance?.id == "workspaces") {
          if (plugin?._loaded) {
            // load
            this.isNativePluginEnabled = true;
            // this.setWorkspaceName();
          } else {
            // unload
            this.isNativePluginEnabled = false;
            // this.setWorkspaceName();
          }
        }
      })
    );

    // add the settings tab
    this.addSettingTab(new WorkspacesPlusSettingsTab(this.app, this));

    this.registerEventHandlers();
    this.registerCommands();

    this.app.workspace.onLayoutReady(() => {
      this.setPlatformWorkspace();
      // store current Obsidian settings into local plugin storage
      if (this.settings.workspaceSettings) this.storeGlobalSettings();

      this.backupCoreConfig();

      setTimeout(() => {
        this.registerWorkspaceHotkeys();
        this.setWorkspaceAttribute();
        this.addStatusBarIndicator.apply(this);
        if (this.settings.workspaceSettings) this.enableModesFeature();
        if (this.settings.workspaceSwitcherRibbon) {
          this.toggleWorkspaceRibbonButton();
          this.toggleNativeWorkspaceRibbon();
        }
        if (this.settings.workspaceSettings && this.settings.modeSwitcherRibbon) {
          this.toggleModeRibbonButton();
        }
      }, 100);
    });

        this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source) => {
        menu.addItem((item) => {

            const subMenu = item.setSubmenu();

            for(const workspaceName in this.workspacePlugin.workspaces)
            {
              subMenu.addItem((item) => {
                    item.setTitle(workspaceName)
                        .onClick((e) => {
                          const targetArray = this.workspacePlugin.workspaces[workspaceName].main.children[0].children;
                          const sourceLeaf = this.app.workspace.activeLeaf;

                          const copiedStack = [];

                          for(const stackItem in sourceLeaf['pane-relief:history-v1'].stack)
                          {
                            // console.log(sourceLeaf['pane-relief:history-v1'].stack[stackItem]);
                            copiedStack.push(sourceLeaf['pane-relief:history-v1'].stack[stackItem].raw);
                          }
                          const copiedLeaf = {
                            id: sourceLeaf.id,
                            "pane-relief:history-v1": {
                              pos: sourceLeaf['pane-relief:history-v1'].pos,
                              stack: copiedStack,
                            },
                            type: sourceLeaf.type,
                            state: sourceLeaf.getViewState(),
                          };
                          targetArray.push(copiedLeaf);
                          // console.log("aaaaaaaaaaa")
                          // console.log(targetArray[1]);
                          // console.log(sourceLeaf);
                          // console.log(copiedLeaf);
                          // console.log("aaaaaaaaaaa")

                          if (!sourceLeaf.pinned)
                          {
                            sourceLeaf.detach()
                          }
                          workspacePluginPlus.workspacePlugin.saveWorkspace();
                      });
                  });
            }

            item.setTitle("send to workspace...")
                .setIcon("lucide-layout");
            //     .onClick((a) => {
            //     //@ts-ignore
            //     //this.app.commands.executeCommandById(command.id);
            //       console.log("aaaaaaaaaaa")
            //       console.log(this.workspacePlugin.workspaces)
            //       for(i in this.workspacePlugin.workspaces)
            //       {
            //         console.log(i);
            //       }
            //       console.log("aaaaaaaaaaa")
            //       // this.workspacePlugin.saveData();
            //       // this.app.workspace.getLeaf("tab").openFile(file)
            // });
        });
    }));
  }

  backupCoreConfig() {
    this.backupConfigFile("workspaces");
    this.backupConfigFile("app");
    this.backupConfigFile("appearance");
  }

  async backupConfigFile(configType: string): Promise<void> {
    const configFileName = this.manifest.dir + `/${configType}.json.bak`;
    const fileExists = await this.app.vault.exists(configFileName);
    if (!fileExists) {
      const configData = await this.app.vault.readConfigJson(configType);
      if (configData) return this.app.vault.writeJson(configFileName, configData, true);
    }
  }

  onunload(): void {
    if (this.settings.workspaceSettings) {
      let combinedSettings = this.mergeGlobalSettings();
      this.applySettings(combinedSettings);
    }
    delete document.body.dataset.workspaceMode;
    delete document.body.dataset.workspaceName;
    if (this.settings.replaceNativeRibbon && this.nativeWorkspaceRibbonItem) {
      this.nativeWorkspaceRibbonItem.show();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  registerCommands() {
    this.addCommand({
      id: "open-workspaces-plus",
      name: "Open Workspaces Plus",
      callback: () => new WorkspacesPlusPluginWorkspaceModal(this, this.settings, true).open(),
    });
    this.addCommand({
      id: "save-workspace",
      name: `Save current workspace`,
      callback: () => {
        this.workspacePlugin.saveWorkspace(this.workspacePlugin.activeWorkspace);
        new Notice("Successfully saved workspace: " + this.workspacePlugin.activeWorkspace);
      },
    });
  }

  registerEventHandlers() {
    this.registerEvent(this.app.workspace.on("workspace-delete", this.onWorkspaceDelete));
    this.registerEvent(this.app.workspace.on("workspace-rename", this.onWorkspaceRename));
    this.registerEvent(this.app.workspace.on("workspace-save", this.onWorkspaceSave));
    this.registerEvent(this.app.workspace.on("workspace-load", this.onWorkspaceLoad));
    this.registerEvent(this.app.workspace.on("layout-change", this.onLayoutChange));
    this.registerEvent(this.app.workspace.on("resize", this.onLayoutChange));
  }

  get changeWorkspaceButton() {
    return this.statusBarWorkspace?.querySelector(".status-bar-item-segment.name");
  }

  get changeModeButton() {
    return this.statusBarMode?.querySelector(".status-bar-item-segment.name");
  }

  setPlatformWorkspace(): void {
    if (!this.isNativePluginEnabled) return;
    // note: don't call this too early in the init process or setActiveWorkspace will wipe all workspaces
    const _activeWorkspace = this.app.isMobile
      ? this.settings.activeWorkspaceMobile
      : this.settings.activeWorkspaceDesktop;
    if (_activeWorkspace) {
      this.workspacePlugin.setActiveWorkspace(_activeWorkspace);
    }
  }

  toggleNativeWorkspaceRibbon(): void {
    if (this.settings.replaceNativeRibbon) {
      if (!this.nativeWorkspaceRibbonItem) {
        this.nativeWorkspaceRibbonItem = document.body.querySelector('[aria-label="Manage workspaces"]');
      }
      this.nativeWorkspaceRibbonItem?.hide();
    } else {
      this.nativeWorkspaceRibbonItem?.show();
    }
  }

  toggleWorkspaceRibbonButton(): void {
    if (this.settings.workspaceSwitcherRibbon) {
      if (!this.ribbonIconWorkspaces) {
        this.ribbonIconWorkspaces = this.addRibbonIcon("pane-layout", "Manage workspaces", async () =>
          new WorkspacesPlusPluginWorkspaceModal(this, this.settings, true).open()
        );
      }
      this.ribbonIconWorkspaces?.show();
    } else {
      this.ribbonIconWorkspaces?.hide();
    }
  }
  toggleModeRibbonButton(): void {
    if (this.settings.workspaceSettings && this.settings.modeSwitcherRibbon) {
      if (!this.ribbonIconMode) {
        this.ribbonIconMode = this.addRibbonIcon("gear", "Manage modes", async () =>
          new WorkspacesPlusPluginModeModal(this, this.settings, true).open()
        );
      }
      this.ribbonIconMode?.show();
    } else {
      this.ribbonIconMode?.hide();
    }
  }

  enableModesFeature() {
    if (this.settings.workspaceSettings) {
      this.storeGlobalSettings();
      this.addStatusBarIndicator("mode");
      this.addCommand({
        id: "open-workspaces-plus-modes",
        name: "Open Workspaces Plus Modes",
        callback: () => new WorkspacesPlusPluginModeModal(this, this.settings, true).open(),
      });
      if (this.debug) console.log("toggle load", this.workspacePlugin.activeWorkspace);
      this.onWorkspaceLoad(this.workspacePlugin.activeWorkspace);
      this.registerEvent(this.app.vault.on("config-changed", this.onConfigChange));
    }
  }

  disableModesFeature() {
    this.app.vault.off("config-changed", this.onConfigChange);
    let combinedSettings = this.mergeGlobalSettings();
    this.applySettings(combinedSettings);
    this.statusBarMode?.detach();
    this.statusBarMode = null;
    (this.app as any).commands.removeCommand(`${this.manifest.id}:"open-workspaces-plus-modes"`);
  }

  addStatusBarIndicator(modalType: string = "workspace") {
    let statusBarItem;
    const itemName = modalType == "mode" ? "statusBarMode" : "statusBarWorkspace";
    if (this[itemName]) return;
    else statusBarItem = this[itemName] = this.addStatusBarItem();

    statusBarItem.addClass(`${modalType}-switcher`);
    statusBarItem.setAttribute("aria-label", `Switch ${modalType}`);
    statusBarItem.setAttribute("aria-label-position", "top");
    // create the status bar icon
    const icon = statusBarItem.createSpan("status-bar-item-segment icon");
    modalType == "workspace" ? setIcon(icon, "pane-layout") : setIcon(icon, "gear"); // inject svg icon
    // create the status bar text
    let modeText = this.utils.getActiveModeDisplayName();
    statusBarItem.createSpan({
      cls: "status-bar-item-segment name",
      text: !this.isNativePluginEnabled
        ? "Error: The Workspaces core plugin is disabled"
        : modalType == "workspace"
        ? this.utils.activeWorkspace
        : modeText,
      prepend: false,
    });
    // register click handler
    statusBarItem.addEventListener("click", evt => this.onStatusBarClick(evt, modalType));
  }

  onStatusBarClick(evt: MouseEvent, modalType: string) {
    if (!this.isNativePluginEnabled) return;
    // handle the shift click to save current workspace shortcut
    if (evt.shiftKey === true) {
      modalType == "mode" ? this.utils.saveActiveMode() : this.utils.saveActiveWorkspace();
      // why trigger here?
      // this.app.workspace.trigger("layout-change");
      this.registerWorkspaceHotkeys();
      new Notice("Successfully saved " + (modalType == "mode" ? "mode" : "workspace"));
    } else {
      if (modalType === "workspace") new WorkspacesPlusPluginWorkspaceModal(this, this.settings).open();
      if (modalType === "mode") new WorkspacesPlusPluginModeModal(this, this.settings).open();
    }
  }

  setWorkspaceName = debounce(
    () => {
      if (!this.isNativePluginEnabled) {
        this.changeWorkspaceButton?.setText("Error: The Workspaces core plugin is disabled");
      } else {
        this.changeWorkspaceButton?.setText(this.utils.activeWorkspace);
      }
      if (this.settings.workspaceSettings) this.changeModeButton?.setText(this.utils.getActiveModeDisplayName());
    },
    100,
    true
  );

  debouncedSave = debounce(
    // avoid overly serializing the workspace during expensive operations like window resize
    (workspaceName: string) => {
      // avoid errors if the debounced save happens in the middle of a workspace switch
      if (workspaceName === this.utils.activeWorkspace) {
        if (this.debug) console.log("layout invoked save: " + workspaceName);
        this.workspacePlugin.saveWorkspace(workspaceName);
      } else {
        if (this.debug) console.log("skipped saving because the workspace has been changed");
      }
    },
    2000,
    true
  );

  onConfigChange = () => {
    if (!this.settings.workspaceSettings) return;
    if (this.workspaceLoading) {
      if (this.debug) console.log("skipped save due to recent workspace switch");
      return;
    }
    const activeModeName = this.utils.activeModeName;
    if (activeModeName) {
      if (this.debug) console.log("config invoked mode update: " + activeModeName);
      this.workspacePlugin.saveWorkspace(activeModeName);
    } else {
      if (this.debug) console.log("config invoked global update");
      this.updateGlobalSettings();
    }
  };

  onLayoutChange = () => {
    if (!this.workspaceLoading) {
      // TODO: Handle per workspace auto save
      if (this.settings.saveOnChange) {
        this.debouncedSave(this.utils.activeWorkspace);
      }
    }
  };

  setWorkspaceAttribute() {
    const workspace = this.utils.activeWorkspace;
    document.body.dataset.workspaceName = workspace;
    if (this.settings.workspaceSettings) {
      const modeName = this.utils.getActiveModeDisplayName();
      if (modeName) document.body.dataset.workspaceMode = modeName;
    }
  }

  onWorkspaceRename = (name: string, oldName: string) => {
    this.setWorkspaceName();
    // remove the old command
    (this.app as any).commands.removeCommand(`${this.manifest.id}:${oldName}`);
    const hotkeys = (this.app as any).hotkeyManager.getHotkeys(`${this.manifest.id}:${oldName}`);
    // register the new command
    this.registerWorkspaceHotkeys();
    if (hotkeys) {
      // reassign any hotkeys that were assigned to the old command
      (this.app as any).hotkeyManager.setHotkeys(this.manifest.id + ":" + name, hotkeys);
    }
    // update any cMenu buttons that were associated to the old command
    this.updateCMenuIcon(name, oldName);
    // persist changes to disk
    this.workspacePlugin.saveData();
  };

  updateCMenuIcon(name: string, oldName: string) {
    const cMenuPlugin = this.app.plugins.plugins["cmenu-plugin"];
    let cMenuItemIdx = cMenuPlugin?.settings.menuCommands.findIndex(cmd => cmd.id === `${this.manifest.id}:${oldName}`);
    if (!cMenuPlugin || cMenuItemIdx === -1) return;
    let cMenuItems = cMenuPlugin.settings.menuCommands;
    cMenuItems[cMenuItemIdx].id = `${this.manifest.id}:${name}`;
    cMenuItems[cMenuItemIdx].name = `${this.manifest.name}: Load: ${name}`;
    cMenuPlugin.saveSettings();
    // rebuild the cMenu toolbar
    dispatchEvent(new Event("cMenu-NewCommand"));
  }

  onWorkspaceDelete = (workspaceName: string) => {
    this.setWorkspaceName();
    const id = this.manifest.id + ":" + workspaceName;
    (this.app as any).commands.removeCommand(id);
    const hotkeys = (this.app as any).hotkeyManager.getHotkeys(id);
    if (hotkeys) {
      (this.app as any).hotkeyManager.removeHotkeys(this.manifest.id + ":" + workspaceName, hotkeys);
    }
  };

  onWorkspaceSave = async (workspaceName: string, customSettings: any) => {
    if (!this.isNativePluginEnabled) return;
    this.setWorkspaceName();
    this.registerWorkspaceHotkeys();
    if (!customSettings) {
      customSettings = this.utils.getWorkspaceSettings(workspaceName);
    } else {
      customSettings = this.utils.setWorkspaceSettings(workspaceName, customSettings);
    }
    if (this.settings.workspaceSettings && this.utils.isMode(workspaceName)) {
      customSettings.app = this.app.vault.config;
    }
    let explorerFoldState = await this.app.loadLocalStorage("file-explorer-unfold");
    if (explorerFoldState) customSettings.explorerFoldState = explorerFoldState;
    this.workspacePlugin.saveData();
  };

  updatePlatformWorkspace(name: string) {
    if (this.app.isMobile) {
      this.settings.activeWorkspaceMobile = name;
    } else {
      this.settings.activeWorkspaceDesktop = name;
    }
  }

  mergeModeSettings(settings: any) {
    return Object.assign({}, settings["app"]);
  }

  mergeGlobalSettings() {
    return Object.assign({}, this.settings.globalSettings);
  }

  onWorkspaceLoad = (name: string) => {
    this.setWorkspaceName(); // sets status bar text
    this.setWorkspaceAttribute(); // sets HTML data attribute
    this.updatePlatformWorkspace(name);
    const settings = this.utils.getWorkspaceSettings(name);
    if (this.settings.workspaceSettings) {
      const modeName = settings?.mode;
      const mode = modeName && this.utils.getModeSettings(modeName);
      let combinedSettings;
      if (mode) {
        combinedSettings = this.mergeModeSettings(mode);
        if (this.debug) console.log("loading mode settings", mode, combinedSettings);
      } else {
        combinedSettings = this.mergeGlobalSettings();
        if (this.debug) console.log("loading default settings", combinedSettings);
        settings && (settings["mode"] = null);
      }
      if (this.settings.systemDarkMode) this.utils.updateDarkModeFromOS(combinedSettings);

      this.needsReload(combinedSettings) && this.reloadIfNeeded();
      this.applySettings(combinedSettings);
    }
    if (settings) this.utils.updateFoldState(settings);
    this.saveData(this.settings);
  };

  needsReload(settings: any) {
    return this.settings.reloadLivePreview && settings.livePreview != (this.app.vault.config as any).livePreview;
  }

  reloadIfNeeded = debounce(() => {
    function sleep(ms: number) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    // this is currently the only way to tell if CM6 is actually loaded on desktop
    const isLoaded = (this.app as any).commands.editorCommands["editor:toggle-source"] ? true : false;
    const isEnabled = (this.app.vault.config as any).livePreview;
    if (isEnabled != isLoaded) {
      (this.app.workspace as any).saveLayout().then(async () => {
        while (true) {
          await sleep(100);
          if (this.app.workspace.layoutReady) {
            return window.location.reload();
          } else {
            await sleep(100);
          }
        }
      });
    }
  }, 500);

  applySettings(settings: any) {
    (<any>this.app).disableCssTransition();
    // this emulates what Obsidian does when loading the core settings
    this.app.vault.config = settings;
    this.app.vault.saveConfig();
    // this.app.workspace.updateOptions();
    this.app.setTheme(settings?.theme as string);
    this.app.customCss.setTheme(settings?.cssTheme);
    // this.app.changeBaseFontSize(settings?.baseFontSize as number);
    this.app.customCss.loadData();
    this.app.customCss.applyCss();
    setTimeout(() => {
      (<any>this.app).enableCssTransition();
    }, 1000);
  }

  registerWorkspaceHotkeys() {
    const workspaceNames = Object.keys(this.workspacePlugin.workspaces);
    for (const workspaceName of workspaceNames) {
      this.addCommand({
        id: workspaceName,
        name: `Load: ${workspaceName}`,
        callback: () => {
          this.workspacePlugin.loadWorkspace(workspaceName);
        },
      });
    }
  }

  setLoadingStatus(): void {
    this.workspaceLoading = true;
    setTimeout(() => {
      this.workspaceLoading = false;
    }, 2000);
  }

  updateGlobalSettings(): void {
    this.settings.globalSettings = Object.assign({}, this.settings.globalSettings, this.app.vault.config);
    this.saveData(this.settings);
  }

  storeGlobalSettings() {
    if (Object.keys(this.settings.globalSettings).length === 0) {
      this.settings.globalSettings = Object.assign({}, this.app.vault.config);
      this.saveData(this.settings);
    }
    return this.settings.globalSettings;
  }

  installWorkspaceHooks() {
    // patch the internal workspaces plugin to emit events on save, delete, and load
    const plugin = this;
    this.register(
      around(this.workspacePlugin, {
        saveWorkspace(old) {
          return function saveWorkspace(workspaceName, ...etc) {
            // TODO: Does this prevent saving a workspace with no name?
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            let settings;
            settings = plugin.utils.getWorkspaceSettings(workspaceName);
            const result = old.call(this, workspaceName, ...etc);
            if (plugin.debug) console.log("workspace saved: " + workspaceName);
            this.app.workspace.trigger("workspace-save", workspaceName, settings);
            return result;
          };
        },
        deleteWorkspace(old) {
          return function deleteWorkspace(workspaceName, ...etc) {
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            const result = old.call(this, workspaceName, ...etc);
            this.app.workspace.trigger("workspace-delete", workspaceName);
            return result;
          };
        },
        loadWorkspace(old) {
          return function loadWorkspace(workspaceName, ...etc) {
            if (!workspaceName || !plugin.isNativePluginEnabled) return;
            plugin.setLoadingStatus();
            let result;
            if (plugin.settings.workspaceSettings && plugin.utils.isMode(workspaceName)) {
              // if the workspace being loaded is a mode, invoke the mode loader
              let modeName = workspaceName;
              workspaceName = plugin.utils.activeWorkspace;
              result = plugin.utils.loadMode(workspaceName, modeName);
            } else {
              // result = old.call(this, workspaceName, ...etc);
              const workspace = this.workspaces[workspaceName];
              if (workspace) {
                // TODO: Ensure this stays in sync with the native Obsidian function
                this.activeWorkspace = workspaceName;
                try {
                  plugin.utils.applyFileOverrides(workspaceName, workspace).then(() => {
                    this.app.workspace.changeLayout(workspace);
                    this.saveData();
                  });
                } catch {
                  console.log("failed to apply overrides");
                  this.app.workspace.changeLayout(workspace);
                  this.saveData();
                }
              }
            }
            this.app.workspace.trigger("workspace-load", workspaceName);
            return result;
          };
        },
      })
    );
  }
}
