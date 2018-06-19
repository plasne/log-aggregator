
// includes
import axios from "axios";
import * as chokidar from "chokidar";
import objhash = require("object-hash");
import Configuration, { ConfigurationJSON } from "./Configuration.js";

export default class Configurations extends Array<Configuration> {

    public url?: string;

    private watch(path: string, config: Configuration) {
        if (config.watcher) {
            config.watcher.add(path);
            global.logger.log("debug", `added "${path}" to existing configuration "${config.name}".`);
        } else {
            config.watcher = chokidar.watch(path);
            config.watcher.on("add", path => {
                global.logFiles.notify(path, config);
            }).on("change", path => {
                global.logFiles.notify(path, config);
            });
            global.logger.log("debug", `added configuration "${config.name}".`);
        }
        global.logger.log("verbose", `started watching "${path}" based on configuration "${config.name}".`);
    }

    private unwatch(path: string, config: Configuration) {
        if (config.watcher) {
            config.watcher.unwatch(path);
            global.logger.log("verbose", `unwatched "${path}" based on configuration "${config.name}".`);
        }
    }

    // get the configs and watch/unwatch as appropriate
    async refresh() {
        if (!this.url) return;
        try {

            // asking
            global.logger.log("verbose", `getting configuration from "${this.url}"...`);
            const response = await axios.get(this.url);

            // look for new configs and/or changes to their sources
            const source: ConfigurationJSON[] = response.data;
            for (const config of source) {
                const hash = objhash(config);
                const existing = this.find(c => c.name === config.name);
                if (existing && hash === existing.hash) {
                    global.logger.log("silly", `configuration "${config.name}" was unchanged.`);
                } else if (existing) {
                    global.logger.log("silly", `configuration "${config.name}" was updated.`);

                    // unwatch everything in the old
                    for (const path of existing.sources) {
                        this.unwatch(path, existing);
                    }

                    // remove the old, add this new
                    this.remove(existing);
                    const updated = new Configuration(config);
                    this.push(updated);

                    // start watching everything in the new
                    for (const path of updated.sources) {
                        this.watch(path, updated);
                    }

                } else {
                    global.logger.log("silly", `configuration "${config.name}" was found to be new.`);

                    // create the new configuration
                    const created = new Configuration(config)
                    this.push(created);

                    // start watching all sources of a new config
                    for (const path of created.sources) {
                        this.watch(path, created);
                    }
                    
                }
            }

            // look for any configs that were removed
            const listToRemove = [];
            for (const config of this) {
                const found = source.find(c => c.name === config.name);
                if (!found) {
                    global.logger.log("silly", `configuration "${config.name}" was removed.`);
                    for (const path of config.sources) {
                        this.unwatch(path, config);
                    }
                    listToRemove.push(config);
                }
            }
            for (const config of listToRemove) {
                const index = this.indexOf(config);
                if (index > -1) this.splice(index, 1);
            }

        } catch (error) {
            global.logger.error("Configuration could not be refreshed.");
            global.logger.error(error.stack);
        }
    }

    constructor(url?: string) {
        super();

        // set URL if it exists
        if (url && typeof url === "string") {
            this.url = url;
        }

    }

}