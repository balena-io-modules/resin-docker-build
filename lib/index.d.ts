/// <reference types="node" />
import * as Promise from 'bluebird';
import * as Plugin from './plugin';
/**
 * This class is responsible for interfacing with the docker daemon to
 * start and monitor a build. Most use cases will require a call to
 * registerHooks(...) and a call to createBuildStream(...). Everything
 * else can be done with the hook architecture.
 *
 */
export default class Builder {
    private docker;
    private hooks;
    private layers;
    /**
     * Initialise the builder class, with a pointer to the docker socket.
     *
     * Example:
     * new Builder('/var/run/docker.sock')
     */
    constructor(dockerPath: string);
    /**
     * Register hooks to be called with any builds that occur after this call.
     *
     * If a build is started before this method is called, no hooks will be called
     * as part of that build. If this method is called, and two builds are ran, both
     * builds will use the given hooks.
     *
     * @param {Plugin.BuildHooks} hooks
     *	The object containing hook handling functions.
     *
     * Example:
     *
     * builder.registerHooks({
     *	buildSuccess: (imageId: string) : void {
     *		console.log('Build was successful');
     *	},
     *	buildFailure: (error: string) : void {
     *		console.error('Build was not successful: ' + error);
     *	}
     * });
     *
     */
    registerHooks(hooks: Plugin.IBuildHooks): void;
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
    createBuildStream(buildOpts: Object): NodeJS.ReadWriteStream;
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
    buildDir(dirPath: string, buildOpts: Object): Promise<NodeJS.ReadableStream>;
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
    private callHook;
}
