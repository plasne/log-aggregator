// includes
import azs = require("azure-storage");
import { BlobService } from "azure-storage";

export default class Blob {

    public container: string;
    public service!:  BlobService;

    // write the block blob, or if the container does not exist, create container and then write block blob
    /*
    public async writeOrCreate(blob: string, text: string) {

        // write
        try {
            await this.write(blob, text);
            return;
        } catch (e) {
            global.logger.log("error", `could not write to container: ${e}`);
        }

        // create container, write
        global.logger.log("verbose", `attempting to create container "${this.container}"`);
        try {
            await this.createContainer();
            await this.write(blob, text);
        } catch (e) {
            global.logger.error(`could not create container "${this.container}"`);
            global.logger.error(e.stack);
        }

    }
    */

    // create the azure container
    /*
    private createContainer() {
        return new Promise<BlobService.ContainerResult>((resolve, reject) => {
            this.service.createContainerIfNotExists(this.container, (error, result) => {
                if (!error) {
                    resolve(result);
                } else {
                    global.logger.log("error", `container "${this.container}" could not be created: ${error}`);
                    reject(error);
                }
            });
        });
    }
    */

    // write block blob
    public write(blob: string, text: string) {
        return new Promise<BlobService.BlobResult>((resolve, reject) => {
            this.service.createBlockBlobFromText(this.container, blob, text, (error, result) => {
                if (!error) {
                    resolve(result);
                } else {
                    reject(error);
                }
            });
        });
    }

    // read specified block blob contents
    public read(name: string) {
        return new Promise<string>((resolve, reject) => {
            this.service.getBlobToText(this.container, name, (error, result) => {
                if (!error) {
                    resolve(result);
                } else {
                    reject(error);
                }
            });
        });
    }

    private listSegment(all: BlobService.BlobResult[], token: azs.common.ContinuationToken | null = null) {
        return new Promise<void>((resolve, reject) => {
            this.service.listBlobsSegmented(this.container, token, (error, result) => {
                if (!error) {
                    for (const entry of result.entries) {
                        if (entry.blobType === "BlockBlob") all.push(entry);
                    }
                    if (result.continuationToken) {
                        this.listSegment(all, result.continuationToken).then(() => {
                            resolve();
                        }, error => {
                            reject(error)
                        });
                    } else {
                        resolve();
                    }
                } else {
                    reject(error);
                }
            });
        });
    }

    // list all blobs in container
    public async list(pattern?: RegExp) {

        // get all blobs
        const all: BlobService.BlobResult[] = [];
        await this.listSegment(all);

        // filter if a pattern should be applied
        if (pattern) {
            return all.filter(entry => pattern.test(entry.name));
        } else {
            return all;
        }

    }

    constructor(url: string, key?: string, sas?: string) {
        const match = /^(?<host>http(?:s)?:\/\/(?<account>.+)\.blob\.core\.windows\.net)\/(?<container>.+)$/gm.exec(url);
        if (match && match.groups && match.groups.host && match.groups.account && match.groups.container) {
            this.container = match.groups.container;
            if (sas) {
                this.service = azs.createBlobServiceWithSas(match.groups.host, sas);
            } else if (key) {
                this.service = azs.createBlobService(match.groups.account, key);
            } else {
                global.logger.error(`a STORAGE_KEY or STORAGE_SAS must be provided if Azure Blob Storage is to be used for STATE_PATH.`);
            }
        } else {
            this.container = "";
            global.logger.error(`the URL "${url}" was not a valid Azure Blob Storage container URL.`);
        }
    }
}