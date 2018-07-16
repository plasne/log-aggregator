
// includes
import * as fs from "fs";
import * as util from "util";
import Blob from "./Blob";

// promisify
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

export default class FileHandler<T> extends Array<T> {

    private blob?: Blob;

    protected async list(pattern?: RegExp) {
        if (!this.blob) throw new Error("list can only be called when blob storage is used");
        return this.blob.list(pattern);
    }

    /** This loads a JSON object from a file from the local disk. */
    private async readFromLocal(localpath: string, levelWhenFileIsMissing: string) {
        try {

            // load the file
            global.logger.log("verbose", `loading "${localpath}"...`);
            const raw = await readFileAsync(localpath, {
                encoding: "utf8"
            });
            const obj = JSON.parse(raw);
            return obj;

        } catch (error) {
            if (error.code === "ENOENT") {
                global.logger.log(levelWhenFileIsMissing, `could not load and parse "${localpath}" since it was not found.`);
            } else {
                global.logger.error(`could not load and parse "${localpath}".`);
                global.logger.error(error.stack);
            }
            throw error;
        }
    }

    /** This loads a JSON object from a file from blob storage. */
    private async readFromBlob(blobpath: string, levelWhenFileIsMissing: string) {
        if (!this.blob) throw new Error(`You must call instantiateBlob() first.`);
        try {

            // load the file
            global.logger.log("verbose", `loading "${blobpath}"...`);
            const raw = await this.blob.read(blobpath);
            const obj = JSON.parse(raw);
            return obj;

        } catch (error) {
            console.log(levelWhenFileIsMissing);
            global.logger.error(`could not load and parse "${blobpath}".`);
            global.logger.error(error.stack);
            throw error;
        }
    }

    /** This loads a JSON object. */
    protected async read(path: string, levelWhenFileIsMissing = "error") {
        if (this.blob) {
            return this.readFromBlob(path, levelWhenFileIsMissing);
        } else {
            return this.readFromLocal(path, levelWhenFileIsMissing);
        }
    }

    /** This save a JSON object to the local filesystem. */
    private async writeToLocal(localpath: string, data: any) {
        try {

            // save the file
            await writeFileAsync(localpath, JSON.stringify(data));

        } catch (error) {
            global.logger.error(`could not save "${localpath}".`);
            global.logger.error(error.stack);
            throw error;
        }
    }

    /** This save a JSON object to blob storage. */
    private async writeToBlob(blobpath: string, data: any) {
        if (!this.blob) throw new Error(`You must call instantiateBlob() first.`);
        try {

            // save the file
            await this.blob.write(blobpath, JSON.stringify(data));

        } catch (error) {
            global.logger.error(`could not load and parse "${blobpath}".`);
            global.logger.error(error.stack);
            throw error;
        }
    }

    /** This saves a JSON object. */
    protected async write(relativepath: string, data: any) {
        if (this.blob) {
            return this.writeToBlob(relativepath, data);
        } else {
            return this.writeToLocal(relativepath, data);
        }
    }

    /** This method will instantiate the blob abstraction for use via reads/writes */
    instantiateBlob(url: string, storageKey?: string, storageSas?: string) {
        if (storageKey || storageSas) {
            this.blob = new Blob(url, storageKey, storageSas);
        } else {
            global.logger.error(`either STORAGE_KEY or STORAGE_SAS must be provided if state is in Azure Blob Storage.`);
        }
    }

}