const Docker = require('dockerode');
const tar = require('tar-stream');
const fs = require('fs');
const path = require('path');
const JSONStream = require('JSONStream');
const duplexify = require('duplexify');
const es = require('event-stream');
const _ = require('lodash');

// Import promise this way so that we can use it as a type
import * as Promise from 'bluebird';

// Import hook definitions
import * as Plugin from './plugin';
import * as Utils from './utils';

Promise.promisifyAll(Docker.prototype);
Promise.promisifyAll(fs);
Promise.promisifyAll(tar);

/**
 * This class is responsible for interfacing with the docker daemon to
 * start and monitor a build. Most use cases will require a call to
 * registerHooks(...) and a call to createBuildStream(...). Everything
 * else can be done with the hook architecture.
 *
 */
export default class Builder {

	private docker;
	// Initialise the hooks to the empty object to ensure
	// we don't get undefined errors.
	private hooks: Plugin.BuildHooks = {};
	private layers: string[];

	/**
	 * Initialise the builder class, with a pointer to the docker socket.
	 *
	 * Example:
	 * new Builder('/var/run/docker.sock')
	 */
	constructor(dockerPath: string) {
		this.docker = new Docker({ socketPath: dockerPath })
	}

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
	public registerHooks(hooks: Plugin.BuildHooks) : void {
		this.hooks = hooks;
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
	public createBuildStream(buildOpts: Object) : NodeJS.ReadWriteStream {

		// There has to be a better way to propagate 'this' to the promise .catch
		// handler
		let instance = this;

		this.layers = [];

		// Create a stream to be passed into the docker daemon
		let inputStream = es.through();

		// Create a bi-directional stream
		let dup = duplexify();

		// Connect the input stream to the rw stream
		dup.setWritable(inputStream);

		this.docker.buildImageAsync(inputStream, buildOpts)
		.then( (res) => {
			let outputStream = res
			// parse the json objects
			.pipe(JSONStream.parse())
			// Don't use fat-arrow syntax here, to capture 'this' from es
			.pipe(es.through(function(data) {
				if(data.error) {
					// The build failed, pass this information through to the build failed
					// callback.
					instance.callHook('buildFailure', [data.error]);
					dup.destroy(new Error(data.error));
				} else {
					// Store image layers, so that they can be deleted by the caller if necessary
					let sha: string;
					if((sha = Utils.extractLayer(data.stream)) != undefined) {
						instance.layers.push(sha);
					}

					this.emit('data', data.stream);
				}
			}));

			// Setup the buildSuccess hook. This handler is not called on
			// error so we can use it to propagate the success information
			outputStream.on('end', () => {
				this.callHook('buildSuccess', [_.last(this.layers), this.layers]);
			});
			// Connect the output of the docker daemon to the duplex stream
			dup.setReadable(outputStream);

		})
		.catch((err) => {
			// Call the plugin's error handler
			instance.callHook('buildFailure', [err.toString()]);
		});

		// Call the correct hook with the build stream
		this.callHook('buildStream', [dup]);
		// and also return it
		return dup;
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
	private callHook = (hook: string, args: any[]) : any => {
		if(hook in this.hooks) {
			// Spread the arguments onto the callback function
			return this.hooks[hook](...args);
		} else {
			return undefined;
		}
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
	public buildDir(dirPath: string, buildOpts: Object): Promise<NodeJS.ReadableStream> {
		return new Promise((resolve, reject) => {

			let pack = tar.pack();

			Promise.all(
				fs.readdirAsync(dirPath)
				.map((file) => {
					// Build the fully qualified relative path
					let relPath = path.join(dirPath, file);
					let stats = fs.statSync(relPath);

					// Add this file to the tar archive
					// FIXME: Use streams to add to the tar archive
					return pack.entryAsync({name: file, size: stats.size}, fs.readFileSync(relPath));
				}))
				.then(() => {
					// Tell the tar stream we're done
					pack.finalize();
					// Create a build stream to send the data to
					let stream = this.createBuildStream(buildOpts);
					// Write the tar archive to the stream
					pack.pipe(stream);
					// ...and return it for reading
					resolve(stream);
				});
		});
	}
}

