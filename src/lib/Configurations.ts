
// includes
import { v4 as uuid } from "uuid";
import axios from "axios";
import { Router } from "express";
import * as chokidar from "chokidar";
import objhash = require("object-hash");
import * as path from "path";
import FileHandler from "./FileHandler";
import Configuration, { ConfigurationJSON } from "./Configuration.js";

type modes = "controller" | "dispatcher";

export interface ConfigurationsJSON {
    mode:        modes,
    url?:        string,
    path?:       string,
    storageKey?: string,
    storageSas?: string
}

export default class Configurations extends FileHandler<Configuration> {

    public mode:       modes;
    public url?:       string;
    public router?:    Router;

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

            // kk: if statement here to get from blob or local???

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
                            global.logger.log("silly", `"${req.params.hostname}" was not given config "${config.name}" because it was disabled.`);
                        } else if (!config.targets || config.targets.length < 1) {
                            list.push(config.json);
                            global.logger.log("silly", `"${req.params.hostname}" was given config "${config.name}" because no targets are specified.`);
                        } else if (config.targets.includes(req.params.hostname)) {
                            list.push(config.json);
                            global.logger.log("silly", `"${req.params.hostname}" was given config "${config.name}" because it is listed as a target.`);
                        } else {
                            global.logger.log("silly", `"${req.params.hostname}" was not given config "${config.name}" because it was not listed as a target.`);
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

    private async update(path: string, obj: ConfigurationJSON) {

        // set the name based on the filename
        const match = /(.*\/)?(?<name>.*).cfg.json$/gm.exec(path);
        obj.name = (match && match.groups && match.groups.name) ? match.groups.name : uuid();

        // instantiate a new controller
        //  if mode = "controller", dispose of all destinations that aren't needed
        const instantiate = (obj: ConfigurationJSON) => {
            const config = new Configuration(obj);
            config.path = path;
            if (this.mode === "controller" && config.name !== "events" && config.destinations) {
                config.destinations.forEach(destination => destination.dispose());
            }
            return config;
        }

        // add or update
        const index = this.findIndex(config => config.name === obj.name);
        if (index < 0) {
            this.push( instantiate(obj) );
            global.logger.log("verbose", `loaded "${obj.name}".`);
        } else {
            this[index] = instantiate(obj);
            global.logger.log("verbose", `updated "${obj.name}".`);
        }

    }

    private watchLocal(localfolder: string) {

        // use chokidar to watch
        const configPath = path.join(localfolder, "*.cfg.json");
        global.logger.log("verbose", `started watching "${configPath}" for configuration files...`);
        const configWatcher = chokidar.watch(configPath);

        // handle add, change, move/delete
        configWatcher.on("add", async localpath => {
            const obj = await this.read(localpath) as ConfigurationJSON;
            await this.update(localpath, obj);
        }).on("change", async localpath => {
            const obj = await this.read(localpath) as ConfigurationJSON;
            await this.update(localpath, obj);
        }).on("raw", (event, localpath) => {
            if (event === "moved" || event === "deleted") {
                this.delete(localpath);
            }
        });

    }

    private async watchBlob(url: string, storageKey?: string, storageSas?: string) {

        // instantiate the blob service provider
        this.instantiateBlob(url, storageKey, storageSas);

        // get a list of all files in the container
        try {
            global.logger.log("verbose", `getting a list of *.cfg.json files from "${url}"...`);
            const list = await this.list(/.+\.cfg\.json$/gm);

            // load each file found
            for (const entry of list) {
                const obj = await this.read(entry.name) as ConfigurationJSON;
                await this.update(entry.name, obj);
            }
            global.logger.log("verbose", `${list.length} *.cfg.json files found at "${url}".`);

        } catch (ex) {
            global.logger.error(`could not read the list of *.cfg.json files from "${url}".`);
            global.logger.error(ex.stack);
        }

        // endpoint for blob storage to report a change event
        /*
        if (this.router) {
            this.router.post("/blob-changed", (req, res) => {
                const event = req.body[0];

                // respond correctly to a validation request
                const eventType = req.get("Aeg-Event-Type");
                if (eventType && eventType === "SubscriptionValidation") {
                    const isValidationEvent = event && event.data &&
                        event.data.validationCode &&
                        event.eventType && event.eventType == "Microsoft.EventGrid.SubscriptionValidationEvent";
                    if (isValidationEvent) {
                        res.send({
                            "validationResponse": event.data.validationCode
                        });
                        return;
                    }
                }
            
                // document
                if (event.eventType == "Microsoft.Storage.BlobCreated") {
                    global.logger.log("verbose", `Blob created`);
                }
            
                global.logger.log("debug", `EventGrid event: ${JSON.stringify(req.body)}`);
                res.status(200).end();

            });
        }
        */

    }

    constructor(obj: ConfigurationsJSON) {
        super();

        // startup depending on the mode
        this.mode = obj.mode;
        switch (this.mode) {
            case "controller":

                // expose endpoints
                this.expose();

                // start watching the configuration files
                if (obj.path) {
                    if (obj.path.startsWith("http://") || obj.path.startsWith("https://")) {
                        this.watchBlob(obj.path, obj.storageKey, obj.storageSas);
                    } else {
                        this.watchLocal(obj.path);
                    }
                }

                break;

            case "dispatcher":
                if (obj.url) this.url = obj.url;
                break;

        }

    }

}