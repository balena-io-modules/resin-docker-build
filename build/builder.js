"use strict";
const Promise = require("bluebird");
const Dockerode = require("dockerode");
const _ = require("lodash");
const fs = require("mz/fs");
const path = require("path");
// Type-less imports
const tar = require('tar-stream');
const duplexify = require('duplexify');
// Following types are available, but do not work...
const es = require('event-stream');
const JSONStream = require('JSONStream');
const Utils = require("./utils");
Promise.promisifyAll(Dockerode);
Promise.promisifyAll(tar);
/**
 * This class is responsible for interfacing with the docker daemon to
 * start and monitor a build. Most use cases will require a call to
 * registerHooks(...) and a call to createBuildStream(...). Everything
 * else can be done with the hook architecture.
 *
 */
class Builder {
    /**
     * Initialise the builder class, with a pointer to the docker socket.
     *
     * Example:
     * new Builder({ socketPath: '/var/run/docker.sock' })
     */
    constructor(dockerOpts) {
        this.readdirBluebird = Promise.promisify(fs.readdir);
        this.docker = new Dockerode(dockerOpts);
        this.dockerAsync = Promise.promisifyAll(this.docker);
    }
    /**
     * Start a build with the docker daemon, and return the stream to the caller.
     * The stream can be written to, and the docker daemon will interpret that
     * as a tar archive to build. The stream can also be read from, and the data
     * returned will be the output of the docker daemon build.
     *
     * @returns {NodeJS.ReadWriteStream}
     *	A promise which resolves with a bi-directional stream, which is connected
     *	to the docker daemon.
     */
    createBuildStream(buildOpts, hooks = {}) {
        const self = this;
        this.layers = [];
        // Create a stream to be passed into the docker daemon
        const inputStream = es.through();
        // Create a bi-directional stream
        const dup = duplexify();
        // Connect the input stream to the rw stream
        dup.setWritable(inputStream);
        this.dockerAsync.buildImageAsync(inputStream, buildOpts)
            .then((res) => {
            const outputStream = res
                .pipe(JSONStream.parse())
                .pipe(es.through(function (data) {
                if (data == null) {
                    return;
                }
                if (data.error) {
                    dup.destroy(new Error(data.error));
                }
                else {
                    // Store image layers, so that they can be deleted by the caller
                    // if necessary
                    let sha = Utils.extractLayer(data.stream);
                    if (sha !== undefined) {
                        self.layers.push(sha);
                    }
                    this.emit('data', data.stream);
                }
            }));
            // Catch any errors the stream produces
            outputStream.on('error', (err) => {
                self.callHook(hooks, 'buildFailure', err);
            });
            dup.on('error', (err) => {
                self.callHook(hooks, 'buildFailure', err);
            });
            // Setup the buildSuccess hook. This handler is not called on
            // error so we can use it to propagate the success information
            outputStream.on('end', () => {
                this.callHook(hooks, 'buildSuccess', _.last(this.layers), this.layers);
            });
            // Connect the output of the docker daemon to the duplex stream
            dup.setReadable(outputStream);
        })
            .catch((err) => {
            // Call the plugin's error handler
            self.callHook(hooks, 'buildFailure', err);
        });
        // Call the correct hook with the build stream
        this.callHook(hooks, 'buildStream', dup);
        // and also return it
        return dup;
    }
    /**
     * Given a path, this function will create a tar stream containing all of the files,
     * and stream it to the docker daemon. It will then return a stream connected to
     * the output of the docker daemon.
     *
     * @param {string} dirPath
     *	The directory path to send to the docker daemon.
     *
     * @param {Object} buildOpts
     *	Build options to pass to the docker daemon.
     *
     * @returns {Promise<NodeJS.ReadableStream>}
     *	A stream which is connected to the output of the docker daemon
     */
    buildDir(dirPath, buildOpts, hooks) {
        const pack = tar.pack();
        return this.readdirBluebird(dirPath)
            .map((file) => {
            const relPath = path.join(dirPath, file);
            return Promise.all([file, fs.stat(relPath), fs.readFile(relPath)]);
        })
            .map((fileInfo) => {
            return pack.entryAsync({ name: fileInfo[0], size: fileInfo[1].size }, fileInfo[2]);
        })
            .then(() => {
            // Tell the tar stream we're done
            pack.finalize();
            // Create a build stream to send the data to
            const stream = this.createBuildStream(buildOpts, hooks);
            // Write the tar archive to the stream
            pack.pipe(stream);
            // ...and return it for reading
            return stream;
        });
    }
    /**
     * Internal function to call a hook, if it has been registered for the build.
     *
     * @param {string} name
     *	The name of the hook to be called.
     *
     * @param {any[]} args
     *	The arguments to pass to the hook. The values will be unwrapped before
     *	being passed to the callback.
     *
     * @returns {any} The return value of the function, or nothing if the
     * function does not exist or does not provide a return value
     */
    callHook(hooks, hook, ...args) {
        if (hook in hooks) {
            // Spread the arguments onto the callback function
            const fn = hooks[hook];
            if (_.isFunction(fn)) {
                return fn.apply(null, args);
            }
        }
        return;
    }
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Builder;

//# sourceMappingURL=builder.js.map
