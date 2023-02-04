import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import axios, {
	AxiosInstance,
	AxiosRequestConfig,
	AxiosResponse,
	CreateAxiosDefaults,
} from "axios";
import { URL } from "url";

interface ArchiveBoxPluginSettings {
	[key: string]: any;
	archiveBoxURI: string;
	useBasicAuth: boolean;
	basicAuthUsername: string;
	basicAuthPassword: string;
	archiveBoxUsername: string;
	archiveBoxPassword: string;
	ignoreDomains: string;
	ignoreRFC1918Addresses: boolean;
	archivedBefore: object;
	batchEverySec: number;
	autoSubmitOnModify: boolean;
  cacheURLs: boolean;
  debugMode: boolean;
}

interface archivedStringsHash {
	[url: string]: boolean;
}

const DEFAULT_SETTINGS: ArchiveBoxPluginSettings = {
	archiveBoxURI: "",
	useBasicAuth: false,
	basicAuthUsername: "",
	basicAuthPassword: "",
	archiveBoxUsername: "",
	archiveBoxPassword: "",
	ignoreDomains: "",
	ignoreRFC1918Addresses: true,
	archivedBefore: {},
	batchEverySec: 10,
	autoSubmitOnModify: false,
  cacheURLs: true,
  debugMode: false
};

export default class ArchiveBoxPlugin extends Plugin {
	settings: ArchiveBoxPluginSettings = DEFAULT_SETTINGS;
	archivedBefore: archivedStringsHash = {};

	linkBatch: Array<string> = [];
	lastLinkUpdate: number = 0;
	lastLinkSubmit: number = 0;

	loggedIn: boolean = false;
	isNodeAxios: boolean = false;
	nodeAxiosSession: string = "";

	axios: AxiosInstance;
	statusBarElement: HTMLElement;

	/**
	 * Onload event handler for the ArchiveBox Plugin.
	 */
	public async onload() {
		console.log("Loading ArchiveBox Plugin.");
		await this.loadSettings();

		this.archivedBefore = {};
		this.statusBarElement = this.addStatusBarItem();
		this.addSettingTab(new ArchiveBoxSettingTab(this.app, this));

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (this.settings.autoSubmitOnModify === true) {
					if (this.getFileExtension(file.path) === ".md") {
						const data = await this.app.vault.adapter.read(
							file.path
						);
						this.archiveURLSInData(data); // do not await
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (this.getFileExtension(file.path) === ".md") {
					menu.addItem((item) => {
						item.setTitle("ArchiveBox links...")
							.setIcon("document")
							.onClick(async () => {
								const data = await this.app.vault.adapter.read(
									file.path
								);
								this.archiveURLSInData(data, true); // do not await
							});
					});
				}
			})
		);

		const ok = this.validateSettings();
		if (!ok) {
			return;
		}
		this.initializeAxiosClient();
	}

	/**
	 * OnUnload event for ArchiveBoxPlugin.
	 */
	public onunload() {
		// persist hashes
		this.saveSettings();
	}

	/**
	 * Load Obsidian settings from disk (data.json) if it exists.
	 */
	public async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	/**
	 * Save settings to disk. In most cases this is being called by
	 * the settings tab, so we will re-initialize the axios client
	 * since it may have changed.
	 *
	 * @param unload Whether or not this is being called by unload.
	 */
	public async saveSettings(unload: boolean = false) {
		await this.saveData(this.settings);
		if (unload === false) {
			const ok = this.validateSettings();
			if (ok) {
				this.initializeAxiosClient();
			}
		}
	}

	/**
	 * Validate that settings are sane. This is more than just
	 * type enforcement and is meant to provide user feedback to
	 * misconfiguration.
	 *
	 * @param updateStatusBar Whether or not to update status bar with a warning.
	 */
	protected validateSettings(updateStatusBar: boolean = true): boolean {
    if (this.settings.debugMode === true) {
      console.log("Validating settings.");
    }

		// 1. Check URI.
		try {
			new URL(this.settings.archiveBoxURI);
		} catch (e) {
			if (updateStatusBar) {
				this.updateStatusBar("❌ Missing ArchiveBox URI.");
			}
      if (this.settings.debugMode === true) {
        console.log("Settings validation failed, missing ArchiveBox URI.");
      }
			return false;
		}

		// 2. Check if username or password exists, the other exists.
		if (
			(this.settings.username === "" && this.settings.password !== "") ||
			(this.settings.password === "" && this.settings.username !== "")
		) {
			if (updateStatusBar) {
				if (this.settings.username === "") {
					this.updateStatusBar("❌ Missing ArchiveBox username");
				} else {
					this.updateStatusBar("❌ Missing ArchiveBox password");
				}
			}
      if (this.settings.debugMode === true) {
        console.log("Settings validation failed, missing username/password");
      }
			return false;
		}

		// 3. Check if basic auth is on, that a username and password is set
		if (this.settings.useBasicAuth === true) {
			if (this.settings.basicAuthUsername === "") {
				if (updateStatusBar) {
					this.updateStatusBar("❌ Missing basic auth username");
				}
        if (this.settings.debugMode === true) {
          console.log("Settings validation failed, basic auth enabled but no username");
        }
				return false;
			}
			if (this.settings.basicAuthPassword === "") {
				if (updateStatusBar) {
					this.updateStatusBar("❌ Missing basic auth password");
				}
        if (this.settings.debugMode === true) {
          console.log("Settings validation failed, basic auth enabled but no password");
        }
				return false;
			}
		}

		return true;
	}

	/**
	 * Searches a markdown file for all http/https
	 * links and submits them to ArchiveBox for archiving.
	 * Assumes the file is not gigantic and can be read into RAM.
	 *
	 * @param filepath
	 */
	protected async archiveURLSInData(
		data: string,
		immediate: boolean = false
	) {
		const rexp = /\[[^\(\)]+\]\(([^\[\]\(\)]+)\)/g;
		let links: Array<string> = [];

		let match: RegExpMatchArray | null;
		while ((match = rexp.exec(data))) {
			try {
				if (match[1].contains(" ")) {
					// for some reason, Wikipedia copypasta likes to add
					// spaces after the URI. A nonencoded space is not valid
					// in a URI, so we will simply split at it and try to salvage.
					match[1] = match[1].split(" ")[0];
				}
				let url = new URL(match[1]);
				let urlhash = await this.SHA256(match[1]);
				if (this.settings.cacheURLs === true && (urlhash in this.archivedBefore)) {
					console.log(`Ignoring already matched ${match[1]}.`);
					continue;
				}
				if (this.settings.ignoreRFC1918Addresses) {
					if (this.isRfc1918Address(url)) {
						console.log(`Ignoring RFC1918 address ${url.hostname}`);
						continue;
					}
				}
				if (
					this.settings.ignoreDomains !== "" &&
					this.isIgnoredDomain(url)
				) {
					console.log(
						`Ignoring ${url.hostname} as it is in the ignored domains list`
					);
					continue;
				}
				console.log(`Adding ${match[1]}`);
				links.push(match[1]);
			} catch (e) {
				console.log(`Captured non-URI ${match[1]}, ignoring...`);
				throw e;
			}
		}
		await this.submitToArchiveBox(links, immediate);
	}

	/**
	 * Batch-submits a list of URIs to ArchiveBox. Does not deduplicate; assumes
	 * that ArchiveBox will deduplicate for things it already has in its archive.
	 * @param links
	 * @param forceUpdate Flushes the links queue entirely on-demand.
	 */
	protected async submitToArchiveBox(
		links: Array<string>,
		forceUpdate: boolean = false
	) {
		if (this.loggedIn === false) {
			console.log(`ArchiveBox: Getting session...`);
			this.updateStatusBar("Logging into ArchiveBox...");
			await this.loginToArchiveBox(
				this.settings.archiveBoxUsername,
				this.settings.archiveBoxPassword
			);
		}

		this.linkBatch = this.linkBatch.concat(links);
		if (
			forceUpdate === true ||
			(this.linkBatch.length > 0 &&
				(this.lastLinkUpdate === 0 ||
					this.lastLinkSubmit === 0 ||
					this.lastLinkUpdate - this.lastLinkSubmit >
						this.settings.batchEverySec * 1000))
		) {
			this.updateStatusBar(`Archiving ${this.linkBatch.length} links...`);
			await this.addUrlsToArchiveBox(this.linkBatch);
			this.updateStatusBar(``);
			this.linkBatch = [];
		}
	}

	/**
	 * Initialize the Axios client with the correct credential
	 * information.
	 */
	protected async initializeAxiosClient() {
		let configOptions: CreateAxiosDefaults = {
			withCredentials: true,
			baseURL: this.settings.archiveBoxURI,
			adapter: "http",
			headers: {
				"Accept-Encoding": "gzip,deflate,compress",
			},
		};

		this.isNodeAxios = configOptions.adapter === "http";
		if (this.isNodeAxios) {
			console.log("This axios is Node-powered.");
		}
		if (this.settings.useBasicAuth) {
			configOptions = Object.assign(configOptions, {
				auth: {
					username: this.settings.basicAuthUsername,
					password: this.settings.basicAuthPassword,
				},
			});
		}

		this.loggedIn = false;
		this.axios = axios.create(configOptions);
	}

	/**
	 * Log into ArchiveBox. Yields a session token that can be used to /add.
	 * This will be redone every session.
	 *
	 * @param username ArchiveBox username.
	 * @param password ArchiveBox password.
	 */
	protected async loginToArchiveBox(
		username: string,
		password: string
	): Promise<void> {
    if (this.settings.debugMode === true) {
      console.log("Logging into ArchiveBox...");
    }
		try {
			const loginForm = await this.axios.get("/admin/login");
			const csrftokenRexp = /^csrftoken=([^;]+);/;
			const sessionidRexp = /^sessionid=([^;]+);/;

			let nodeCSRFToken: string = "";
			if (this.isNodeAxios) {
        if (this.settings.debugMode === true) {
          console.log("Attempting to retrieve CSRF token from /admin/login");
        }
				// retrieve the csrf token cookie
				if (loginForm.headers["set-cookie"]) {
					// you can't assume there aren't multiple set-cookie
					// responses, so we need to take csrftoken out of
					// the one that it exists in.
					loginForm.headers["set-cookie"].forEach((cookie) => {
						let possibleToken = cookie.match(csrftokenRexp);
						if (possibleToken && possibleToken.length > 1) {
							nodeCSRFToken = possibleToken[1];
              if (this.settings.debugMode === true) {
                console.log("Got CSRF token! " + nodeCSRFToken.substring(5) + "...");
              }
						}
					});
				}
			}

			let config: AxiosRequestConfig = {};
			if (this.isNodeAxios) {
				config = {
					headers: {
						Cookie: `csrftoken=${nodeCSRFToken};`,
						"Content-Type": "application/x-www-form-urlencoded",
						Referer: `${this.settings.archiveBoxURI}/admin/login/`,
					},
					maxRedirects: 0, // we need to pick up the sessionid off this redirect
					validateStatus: function (status) {
						return status >= 200 && status <= 302;
					},
				};
			}
      if (this.settings.debugMode === true) {
        console.log("Attempting to use CSRF token.");
      }
			const response: AxiosResponse = await this.axios.post(
				"/admin/login/",
				{
					csrfmiddlewaretoken: nodeCSRFToken,
					username: username,
					password: password,
					next: "/add",
				},
				config
			);
			if (this.isNodeAxios) {
				if (response.headers["set-cookie"]) {
					response.headers["set-cookie"].forEach((cookie) => {
						const match = cookie.match(sessionidRexp);
						if (match && match.length > 1) {
							// TODO capture expiry to retrigger login flow
              this.nodeAxiosSession = match[1];
              if (this.settings.debugMode === true) {
                console.log("Captured login session.");
                console.log(this.nodeAxiosSession.substring(4) + "...");
              }
							this.loggedIn = true;
						}
					});
				}
			}
		} catch (error) {
			this.updateStatusBar("ArchiveBox login failed.");
			throw error;
		}
	}

	/**
	 * Adds an array of URLs to archivebox by POSTing.
	 * Assumes that you are already logged in.
	 *
	 * @param urls An array of URLs to archive.
	 */
	protected async addUrlsToArchiveBox(urls: string[]) {
		try {
			let config: AxiosRequestConfig = {
				timeout: 2000,
			};
			if (this.isNodeAxios) {
        if (this.settings.debugMode === true) {
          console.log("Requesting /add/");
        }
				config = Object.assign(config, {
					headers: {
						// CSRF token isn't checked for add to make bookmarklet work
						// but we still need to authenticate.
						Cookie: `sessionid=${this.nodeAxiosSession}`,
						"Content-Type": "application/x-www-form-urlencoded",
					},
					validateStatus: function (status) {
						return status >= 200 && status <= 302;
					},
					maxRedirects: 0,
				} as AxiosRequestConfig);
			}
			let response = await this.axios.post(
				"/add/",
				{
					url: urls.join("\n"),
					parser: "url_list",
					tag: "obsidian",
					depth: "0",
				},
				config
			);
      if (this.settings.debugMode === true) {
        console.log("Submitted. Status code " + response.status);
        console.log("Successful run, writing URLs to internal cache.");
      }
      for (let i = 0; i < urls.length; i++) {
        let urlhash = await this.SHA256(urls[i]);
				this.archivedBefore[urlhash] = true;
      }
		} catch (error) {
			if (error) {
				// check if this is a timeout error. if it is ignore it
				if (error.code === "ECONNABORTED") return;
        if (this.settings.debugMode === true) {
          console.log("Caught error " + error.code);
        }
			} else {
        // in a failure case, if we are caching the URIs these
        // will falsely be cached. Clear the hashmap.
				this.updateStatusBar("ArchiveBox submission failed.");
				console.error(error);
			}
		}
	}

	/**
	 * Use crypto.subtle to generate a SHA-256 hash.
	 * @param str
	 * @returns
	 */
	protected async SHA256(str: string): Promise<string> {
		// Convert the string to an array buffer
		const buffer = new TextEncoder().encode(str);
		const hash = await crypto.subtle.digest("SHA-256", buffer);
		return btoa(String.fromCharCode.apply(null, new Uint8Array(hash)));
	}

	/**
	 * Returns whether or not a URL is a Private IP address.
	 * In most cases this is something you don't want to disclose
	 * to an ArchiveBox but may want to reference in your Vault.
	 *
	 * @param url a URL object
	 * @returns Whether or not the URL's host is a private IP.
	 */
	protected isRfc1918Address(url: URL): boolean {
		const rfc1918Addresses = [
			"10.0.0.0/8",
			"172.16.0.0/12",
			"192.168.0.0/16",
		];
		const hostname = url.hostname;
		const octets = hostname.split(".").map(Number);

		// Check if the hostname is in any of the CIDR ranges in the list of RFC1918 addresses
		return rfc1918Addresses.some((range) => {
			const [base, prefix] = range.split("/");
			const baseOctets = base.split(".").map(Number);

			if (
				octets.length !== baseOctets.length ||
				!octets.every((octet, i) => octet === baseOctets[i])
			) {
				return false;
			}
			const bits = Number(prefix);
			return octets
				.slice(0, bits / 8)
				.every((octet) => octet === baseOctets[bits / 8]);
		});
	}

	/**
	 * A quick polyfill for path.extname.
	 *
	 * @param filePath A filepath.
	 * @returns The extension of the file.
	 */
	protected getFileExtension(filePath: string): string {
		const lastDotIndex = filePath.lastIndexOf(".");
		if (lastDotIndex === -1) {
			return "";
		}
		return filePath.substring(lastDotIndex);
	}

	/**
	 * Checks if a domain in a URL is in our ignored list.
	 *
	 * @param url A URL object
	 * @returns Whether or not it is in the ignored list.
	 */
	protected isIgnoredDomain(url: URL): boolean {
		const domain = url.hostname;
		const domainList = this.settings.ignoreDomains
			.split(",")
			.map((s) => s.trim());

		return domainList.includes(domain);
	}

	/**
	 * Updates the status bar with text.
	 *
	 * @param text The text to display.
	 */
	protected updateStatusBar(text: string) {
		this.statusBarElement.setText(text);
	}
}

interface ArchiveBoxSettingData {
	type: "text" | "boolean" | "number";
	name: string;
	description: string;
	settingsKey: string;
	placeholder?: string;
}

class ArchiveBoxSettingTab extends PluginSettingTab {
	plugin: ArchiveBoxPlugin;

	constructor(app: App, plugin: ArchiveBoxPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", {
			text: "ArchiveBox Settings",
		});

		/*
		const tpl = `
			Check for updates and information on GitHub.
		`;
		const p = containerEl.createEl("p");
		p.innerHTML = tpl;
		*/

		// set the settings here, iterate over objects below, DRY.
		const ArchiveBoxPluginSettings: Array<ArchiveBoxSettingData> = [
			{
				name: "ArchiveBox URI",
				settingsKey: "archiveBoxURI",
				type: "text",
				description: "The URI to your ArchiveBox instance.",
				placeholder: "https://example.com/archivebox",
			},
			{
				name: "ArchiveBox Username",
				settingsKey: "archiveBoxUsername",
				type: "text",
				description: "The username for the ArchiveBox instance.",
				placeholder: "archivebox",
			},
			{
				name: "ArchiveBox Password",
				settingsKey: "archiveBoxPassword",
				type: "text",
				description: "The password for the ArchiveBox instance.",
				placeholder: "archivebox",
			},
			{
				name: "Ignore RFC1918 Addresses",
				settingsKey: "ignoreRFC1918Addresses",
				type: "boolean",
				description:
					"Ignore private addresses in URIs (e.g. https://192.168.1.1)",
			},
			{
				name: "Ignored Domains",
				settingsKey: "ignoreDomains",
				type: "text",
				description: "Comma-separated value of domains to ignore.",
				placeholder: "github.com,internal.com",
			},
			{
				name: "Use Basic Auth",
				settingsKey: "useBasicAuth",
				type: "boolean",
				description:
					"Use HTTP Basic Authentication in front of ArchiveBox.",
			},
			{
				name: "Basic Auth Username",
				settingsKey: "basicAuthUsername",
				type: "text",
				description: "HTTP Basic Authentication username.",
				placeholder: "archivebox",
			},
			{
				name: "Basic Auth Password",
				settingsKey: "basicAuthPassword",
				type: "text",
				description: "HTTP Basic Authentication password.",
				placeholder: "archivebox",
			},
			{
				name: "Auto-Submit",
				settingsKey: "autoSubmitOnModify",
				type: "boolean",
				description: "Watch files for modification and auto-submit.",
			},
			{
				name: "Minimum Batch Submission Time",
				settingsKey: "batchEverySec",
				type: "number",
				description:
					"How often to send detected links to ArchiveBox via auto-submit.",
				placeholder: "5",
			},
      {
        name: "Cache URIs",
        settingsKey: "cacheURLs",
        type: "boolean",
        description: "Do not re-submit URIs that have already been submitted by this plugin."
      },
      {
        name: "Debug Mode",
        settingsKey: "debugMode",
        type: "boolean",
        description: "Debug mode. Enable only if a developer has asked you for more info."
      }
		];
		const self = this;

		ArchiveBoxPluginSettings.forEach((setting: ArchiveBoxSettingData) => {
			let settingsObject = new Setting(containerEl)
				.setName(setting.name)
				.setDesc(setting.description);
			switch (setting.type) {
				case "text":
					settingsObject.addText((text) => {
						text.setPlaceholder(
							setting.placeholder ? setting.placeholder : ""
						)
							.setValue(
								self.plugin.settings[
									setting.settingsKey as string
								]
							)
							.onChange(async (value) => {
								self.plugin.settings[setting.settingsKey] =
									value;
								await self.plugin.saveSettings();
							});
					});
					break;
				case "number":
					settingsObject.addText((text) => {
						text.setPlaceholder(
							setting.placeholder ? setting.placeholder : ""
						)
							.setValue(
								self.plugin.settings[
									setting.settingsKey as string
								]
							)
							.onChange(async (value) => {
								self.plugin.settings[setting.settingsKey] =
									parseInt(value);
								await self.plugin.saveSettings();
							});
					});
					break;
				case "boolean":
					settingsObject.addToggle((component) => {
						component
							.setValue(self.plugin.settings[setting.settingsKey])
							.onChange(async (value) => {
								self.plugin.settings[setting.settingsKey] =
									value;
								await self.plugin.saveSettings();
							});
					});
					break;
				default:
					console.log(`Cannot set setting of type ${setting.type}`);
					break;
			}
		});
	}
}
