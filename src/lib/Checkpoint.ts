
export interface CheckpointJSON {
    destination:   string;
    ino?:          number;
    path:          string;
    committed?:    number;
    buffered?:     number;
}

export default class Checkpoint implements CheckpointJSON {

    public readonly destination: string;
    public          ino?:        number;
    public readonly path:        string;

    /** The point of the file through which records have been committed (dispatched and accepted). */
    public          committed:   number  = 0;

    /** The point of the file that has been buffered. */
    public          buffered:    number;

    /**
     * A checkpoint describes a pointer in a specific file that is a starting point for new queries.
     * The sections of the file before the pointer have been committed successfully to a remote endpoint.
     */
    constructor(obj: CheckpointJSON) {
        this.destination = obj.destination;
        if (obj.ino) this.ino = obj.ino;
        this.path = obj.path;
        if (obj.committed) this.committed = obj.committed;
        this.buffered = obj.buffered || this.committed;
    }

}