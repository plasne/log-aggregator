
// includes
import axios from "axios";
import Checkpoint from "./Checkpoint";
import Destination from "./Destination";

/**
 * This class helps manage all checkpoints.
 */
export default class Checkpoints extends Array<Checkpoint> {

    public url?:            string = "";
    
    private handle?:        NodeJS.Timer;
    private _isInitialized: boolean = false;

    get isInitialized() {
        return this._isInitialized;
    }

    get isBusy() {
        return (this.handle != null);
    }

    byPathAndDestination(path: string, destinations: Array<Destination>) {
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
                global.logger.log("silly", `byPathAndDestination created a new checkpoint of "${path}" to "${destination}".`);
            }

        }
        return list;
    }

    // get checkpoints from the server
    async fetch() {

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

    report() {
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

    async send() {

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
                const msg = this.report();
    
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

    constructor(url?: string) {
        super();
        
        // set URL if it exists
        if (url && typeof url === "string") {
            this.url = url;
        }

    }

}