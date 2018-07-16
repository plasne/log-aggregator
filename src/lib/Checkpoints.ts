
// includes
import * as path from "path";
import axios from "axios";
import { Router } from "express";
import Checkpoint from "./Checkpoint";
import Destination from "./Destination";
import FileHandler from "./FileHandler";

type modes = "controller" | "dispatcher";

export interface CheckpointsJSON {
    mode:  modes,
    url?:  string,
    path?: string,
    storageKey?: string,
    storageSas?: string
}

/**
 * This class helps manage all checkpoints.
 */
export default class Checkpoints extends FileHandler<Checkpoint> {

    public mode:            modes;
    public url?:            string;
    public router?:         Router;

    private handle?:        NodeJS.Timer;
    private _isInitialized: boolean = false;

    public get isInitialized() {
        return this._isInitialized;
    }

    public get isBusy() {
        return (this.handle != null);
    }

    public byPathAndDestination(path: string, destinations: Destination[]) {
        const list = [];
        for (const destination of destinations) {

            // look for existing
            const existing = this.find(checkpoint => {
                if (checkpoint.path.toLowerCase() !== path.toLowerCase()) return false;
                if (checkpoint.destination !== destination.name) return false;
                return true;
            });

            // create if it doesn't exist
            if (existing) {
                list.push(existing);
            } else {
                const checkpoint = new Checkpoint({
                    destination: destination.name,
                    path: path
                });
                list.push(checkpoint);
                this.push(checkpoint);
                global.logger.log("silly", `of "${path}" to "${destination}".`);
            }

        }
        return list;
    }

    // get checkpoints from the server
    public async fetch() {

        // check for URL
        if (!this.url) {
            global.logger.log("verbose", `an attempt to fetch checkpoints found no URL (abort).`);
            return;
        }

        // fetch
        try {

            // get the checkpoints
            global.logger.log("verbose", `getting checkpoints from "${this.url}"...`);
            const response = await axios.get(this.url);
            for (const obj of response.data) {
                this.push(new Checkpoint(obj));
            }

            // set to initialized
            this._isInitialized = true;

        } catch (error) {
            global.logger.error("checkpoints could not be obtained.");
            global.logger.error(error.stack);
        }

    }

    public toJSON() {
        const output = [];
        for (const checkpoint of this) {
            output.push({
                destination: checkpoint.destination,
                ino: checkpoint.ino,
                path: checkpoint.path,
                committed: checkpoint.committed
            });
        }
        return output;
    }

    public async send() {

        // check for URL
        if (!this.url) {
            global.logger.log("verbose", `an attempt to send checkpoints found no URL (abort).`);
            return;
        }
        const url: string = this.url;

        // the checkpoints are already being sent, abort
        if (this.isBusy) {
            global.logger.log("silly", `an attempt to send checkpoints to "${this.url}" found it busy (abort).`);
            return;
        };

        // function to do the work of sending
        const action = async () => {
            try {

                // craft the message
                const msg = this.toJSON();
    
                // post the message to the controller
                global.logger.log("verbose", `posting checkpoints to "${this.url}"...`);
                await axios.post(url, msg);
                global.logger.log("verbose", `posted checkpoints to "${this.url}".`);

                // clear busy
                this.handle = undefined;
    
            } catch (error) {
                // NOTE: checkpoints do not retry, it is assumed there will be a later checkpoint message soon
                global.logger.error("checkpoints could not be posted.");
                global.logger.error(error.stack);
            }
        }

        // kick off the send action after 1 second
        //  NOTE: if there are multiple destinations that get done in short order,
        //  this lets them send a single checkpoint message
        this.handle = setTimeout(_ => { action(); }, 1000); // this makes the reader busy

    }

    private expose(statepath: string) {
        this.router = Router();

        // provide checkpoints if asked
        this.router.get("/:hostname", async (req, res) => {
            try {

                // asking
                const checkpointPath = path.join(statepath, `${req.params.hostname}.chk.json`);
                global.logger.log("verbose", `"${req.params.hostname}" is asking for checkpoints...`);
                global.logger.log("debug", `looking for file "${checkpointPath}"...`);

                // read the checkpoint file
                try {
                    const obj = await this.read(checkpointPath, "verbose");
                    global.logger.log("verbose", `"${req.params.hostname}" was given the checkpoint file.`);
                    res.send(obj);
                } catch (error) {
                    // errors should be ignored
                    global.logger.log("verbose", `"${req.params.hostname}" was informed there were no checkpoints.`);
                    res.send([]); // send an empty checkpoint file, but it's a 200
                }

            } catch (error) {
                global.logger.error(error.stack);
                res.status(500).end();
            }
        });

        // accept checkpoints
        this.router.post("/:hostname", async (req, res) => {
            try {

                // determine the path
                const checkpointPath = path.join(statepath, `${req.params.hostname}.chk.json`);

                // write the checkpoints
                try {
                    global.logger.log("verbose", `writing checkpoint file "${checkpointPath}"...`);
                    await this.write(checkpointPath, req.body);
                    global.logger.log("verbose", `wrote checkpoint file "${checkpointPath}".`);
                } catch (error) {
                    global.logger.error(`error writing checkpoint file "${checkpointPath}".`);
                    global.logger.error(error.stack);
                }
                res.status(200).end();

            } catch (error) {
                global.logger.error(error.stack);
                res.status(500).end();
            }
        });

    }

    constructor(obj: CheckpointsJSON) {
        super();

        // startup depending on the mode
        this.mode = obj.mode;
        switch (this.mode) {
            case "controller":
                if (obj.path) {

                    // expose endpoints
                    this.expose(obj.path);

                    // start watching the configuration files
                    if (obj.path.startsWith("http://") || obj.path.startsWith("https://")) {
                        this.instantiateBlob(obj.path, obj.storageKey, obj.storageSas);
                    } else {
                        // nothing to do at this point
                    }

                }
                break;

            case "dispatcher":
                if (obj.url) this.url = obj.url;
                break;

        }
        
    }

}