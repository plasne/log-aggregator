
// includes
import axios from "axios";
import { Router } from "express";
import * as chokidar from "chokidar";
import objhash = require("object-hash");
import { v4 as uuid } from "uuid";
import * as fs from "fs";
import * as util from "util";
import * as path from "path";
import Configuration, { ConfigurationJSON } from "./Configuration.js";

// promisify
const readFileAsync = util.promisify(fs.readFile);

type modes = "controller" | "dispatcher";

export interface ConfigurationsJSON {
    mode:  modes,
    url?:  string,
    path?: string
}

export default class Configurations extends Array<Configuration> {

    public mode:    modes;
    public url?:    string;
    public router?: Router;

    /** This is called whenever a configuration file is found to be added or modified. */
    private async updateFromPath(path: string) {
        try {

            // function to instantiate the configuration
            //  if mode = "controller", dispose of all destinations that aren't needed
            const instantiate = (obj: ConfigurationJSON) => {
                const config = new Configuration(obj);
                config.path = path;
                if (this.mode === "controller" && config.name !== "events" && config.destinations) {
                    config.destinations.forEach(destination => destination.dispose());
                }
                return config;
            };

            // load the file
            global.logger.log("verbose", `loading "${path}"...`);
            const raw = await readFileAsync(path, {
                encoding: "utf8"
            });
            const obj = JSON.parse(raw) as ConfigurationJSON;
            const match = /^(.*)\/(?<name>.*).cfg.json$/.exec(path);
            obj.name = (match && match.groups && match.groups.name) ? match.groups.name : uuid();

            // add or update
            const index = this.findIndex(config => config.name === obj.name);
            if (index < 0) {
                this.push( instantiate(obj) );
                global.logger.log("verbose", `loaded "${path}".`);
            } else {
                this[index] = instantiate(obj);
                global.logger.log("verbose", `updated "${path}".`);
            }

        } catch (error) {
            global.logger.error(`could not load and parse "${path}".`);
            global.logger.error(error.stack);
        }
    }

    // overload example
    private delete(config: Configuration): void;
    private delete(path: string): void;
    private delete(configOrPath: Configuration | string) {

        // find by path if necessary
        let config: Configuration;
        if (typeof configOrPath === "string") {
            const found = this.find(c => c.isMatch(configOrPath));
            if (!found) return;
            config = found;
        } else {
            config = configOrPath;
        }

        // remove
        config.dispose();
        this.remove(config);

    }

    // get the configs from the controller and watch/unwatch as appropriate
    public async fetch() {
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
                    existing.unwatchAll();

                    // remove the old, add this new
                    const updated = new Configuration(config, existing);
                    const diff = (updated.destinations || []).diff(existing.destinations || []);
                    diff.targetOnly.forEach(d => d.dispose());
                    this.remove(existing);
                    this.push(updated);

                    // start watching everything in the new
                    updated.watchAll();

                } else {
                    global.logger.log("silly", `configuration "${config.name}" was found to be new.`);

                    // create the new configuration
                    const created = new Configuration(config)
                    this.push(created);

                    // start watching all sources of a new config
                    created.watchAll();
                    
                }
            }

            // look for any configs that were removed
            const listToRemove = [];
            for (const config of this) {
                const found = source.find(c => c.name === config.name);
                if (!found) listToRemove.push(config);
            }
            listToRemove.forEach(config => this.delete(config));

        } catch (error) {
            global.logger.error("Configurations could not be refreshed.");
            global.logger.error(error.stack);
        }
    }

    private expose() {
        this.router = Router();

        // endpoint to get the configs
        this.router.get("/:hostname", (req, res) => {
            try {
        
                // asking
                global.logger.log("verbose", `"${req.params.hostname}" is asking for configs...`);
        
                // filter to those appropriate for the host
                const filtered = (() => {
                    const list: ConfigurationJSON[] = [];
                    for (const config of this) {
                        if (config.enabled === false) {
                            // ignore
                        } else if (!config.targets) {
                            list.push(config.json);
                        } else if (config.targets.includes(req.params.hostname)) {
                            list.push(config.json);
                        } else {
                            // ignore
                        }
                    }
                    return list;
                })();
        
                // return the configurations
                global.logger.log("verbose", `"${req.params.hostname}" received ${filtered.length} configs.`);
                res.send(filtered);
        
            } catch (error) {
                global.logger.error(error.stack);
                res.status(500).end();
            }
        });

    }

    constructor(obj: ConfigurationsJSON) {
        super();

        // startup depending on the mode
        this.mode = obj.mode;
        switch (this.mode) {
            case "controller":

                // expose endpoints
                this.expose();

                // read the config files from a local disk
                if (obj.path) {
                    const configPath = path.join(obj.path, "*.cfg.json");
                    global.logger.log("verbose", `started watching "${configPath}" for configuration files...`);
                    const configWatcher = chokidar.watch(configPath);
                    configWatcher.on("add", path => {
                        this.updateFromPath(path);
                    }).on("change", async path => {
                        this.updateFromPath(path);
                    }).on("raw", (event, path) => {
                        if (event === "moved" || event === "deleted") {
                            this.delete(path);
                        }
                    });
                }

                break;

            case "dispatcher":
                if (obj.url) this.url = obj.url;
                break;

        }

    }

}