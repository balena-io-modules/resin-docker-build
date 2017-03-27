import * as Promise from 'bluebird'
import * as Dockerode from 'dockerode'
import * as _ from 'lodash'
import * as fs from 'mz/fs'
import * as path from 'path'

// Type-less imports
const tar = require('tar-stream')
const duplexify = require('duplexify')
// Following types are available, but do not work...
const es = require('event-stream')
const JSONStream = require('JSONStream')

// Import hook definitions
import * as Plugin from './plugin'
import * as Utils from './utils'

Promise.promisifyAll(Dockerode)
Promise.promisifyAll(tar)

/**
 * This class is responsible for interfacing with the docker daemon to
 * start and monitor a build. Most use cases will require a call to
 * registerHooks(...) and a call to createBuildStream(...). Everything
 * else can be done with the hook architecture.
 *
 */
export default class Builder {

	private docker: Dockerode
	private layers: string[]

	// Promisified types
	private dockerAsync: any
	private readdirBluebird = Promise.promisify(fs.readdir)

	/**
	 * Initialise the builder class, with a pointer to the docker socket.
	 *
	 * Example:
	 * new Builder({ socketPath: '/var/run/docker.sock' })
	 */
	constructor(dockerOpts: Dockerode.DockerOptions) {
		this.docker = new Dockerode(dockerOpts)

		this.dockerAsync = Promise.promisifyAll(this.docker)
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
	public createBuildStream(buildOpts: Object, hooks: Plugin.BuildHooks = {}): NodeJS.ReadWriteStream {

		const self = this

		this.layers = []

		// Create a stream to be passed into the docker daemon
		const inputStream = es.through()

		// Create a bi-directional stream
		const dup = duplexify()

		// Connect the input stream to the rw stream
		dup.setWritable(inputStream)

		this.dockerAsync.buildImageAsync(inputStream, buildOpts)
		.then((res: NodeJS.ReadWriteStream) => {

			const outputStream = res
			// parse the json objects
			.pipe(JSONStream.parse())
			// Don't use fat-arrow syntax here, to capture 'this' from es
			.pipe(es.through(function(data: any): void {
				if (data == null) {
					return
				}
				if (data.error) {
					dup.destroy(new Error(data.error))
				} else {
					// Store image layers, so that they can be deleted by the caller
					// if necessary
					let sha = Utils.extractLayer(data.stream)
					if (sha !== undefined) {
						self.layers.push(sha)
					}

					this.emit('data', data.stream)
				}
			}))

			// Catch any errors the stream produces
			outputStream.on('error', (err: Error) => {
				self.callHook(hooks, 'buildFailure', err)
			})
			dup.on('error', (err: Error) => {
				self.callHook(hooks, 'buildFailure', err)
			})

			// Setup the buildSuccess hook. This handler is not called on
			// error so we can use it to propagate the success information
			outputStream.on('end', () => {
				this.callHook(hooks, 'buildSuccess', _.last(this.layers), this.layers)
			})
			// Connect the output of the docker daemon to the duplex stream
			dup.setReadable(outputStream)

		})
		.catch((err: Error) => {
			// Call the plugin's error handler
			self.callHook(hooks, 'buildFailure', err)
		})

		// Call the correct hook with the build stream
		this.callHook(hooks, 'buildStream', dup)
		// and also return it
		return dup
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
	public buildDir(dirPath: string, buildOpts: Object, hooks: Plugin.BuildHooks): Promise<NodeJS.ReadableStream> {
		const pack = tar.pack()

		return this.readdirBluebird(dirPath)
			.map((file: string) => {
				const relPath = path.join(dirPath, file)
				return Promise.all([file, fs.stat(relPath), fs.readFile(relPath)])
			})
			.map((fileInfo: [string, fs.Stats, Buffer]) => {
				return pack.entryAsync({ name: fileInfo[0], size: fileInfo[1].size }, fileInfo[2])
			})
			.then(() => {
				// Tell the tar stream we're done
				pack.finalize()
				// Create a build stream to send the data to
				let stream = this.createBuildStream(buildOpts, hooks)

				// Transform the stream if necessary
				stream = this.callHook(hooks, 'buildTransform', stream) || stream

				// Write the tar archive to the stream
				pack.pipe(stream)
				// ...and return it for reading
				return stream
			})
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
	private callHook(hooks: Plugin.BuildHooks, hook: Plugin.ValidHook, ...args: any[]): any {
		if (hook in hooks) {
			// Spread the arguments onto the callback function
			const fn = hooks[hook]
			if (_.isFunction(fn)) {
				return fn.apply(null, args)
			}
		}
		return
	}

}

