
// includes
import axios from "axios";
import { Router } from "express";
import * as fs from "fs";
import * as util from "util";
import * as path from "path";
import Checkpoint from "./Checkpoint";
import Destination from "./Destination";

// promisify
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

type modes = "controller" | "dispatcher";

export interface CheckpointsJSON {
    mode:  modes,
    url?:  string
    path?: string
}

/**
 * This class helps manage all checkpoints.
 */
export default class Checkpoints extends Array<Checkpoint> {

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
                global.logger.log("verbose", `"${req.params.hostname}" is asking for checkpoints...`);
                const checkpointsPath = path.join(statepath, `${req.params.hostname}.chk.json`);
                global.logger.log("debug", `looking for checkpoint file "${checkpointsPath}"...`);

                // read the checkpoint file
                try {
                    const raw = await readFileAsync(checkpointsPath, "utf8");
                    const obj = JSON.parse(raw);
                    global.logger.log("verbose", `"${req.params.hostname}" was given the checkpoint file.`);
                    global.logger.log("debug", raw);
                    res.send(obj);
                } catch (error) {
                    if (error.code === "ENOENT") { // file doesn't exist
                        global.logger.log("verbose", `"${req.params.hostname}" was informed there were no checkpoints.`);
                        res.send([]); // send an empty checkpoint file, but it's a 200
                    } else {
                        throw error;
                    }
                }

            } catch (error) {
                global.logger.error(error.stack);
                res.status(500).end();
            }
        });

        // accept checkpoints
        this.router.post("/:hostname", async (req, res) => {
            try {

                // write the checkpoints
                const checkpointsPath = path.join(statepath, `${req.params.hostname}.chk.json`);
                try {
                    global.logger.log("verbose", `writing checkpoint file "${checkpointsPath}"...`);
                    await writeFileAsync(checkpointsPath, JSON.stringify(req.body));
                    global.logger.log("verbose", `wrote checkpoint file "${checkpointsPath}".`);
                } catch (error) {
                    global.logger.error(`error writing checkpoint file "${checkpointsPath}".`);
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
        
        // capture the mode
        this.mode = obj.mode;
        if (this.mode === "controller" && obj.path) this.expose(obj.path);

        // if a URL is specified, checkpoints will be received from a remote controller
        if (obj.url) {
            this.url = obj.url;
            return;
        }

    }

}