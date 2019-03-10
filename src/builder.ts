/**
 * @license
 * Copyright 2018 Balena Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as Bluebird from 'bluebird';
import * as Dockerode from 'dockerode';
import * as duplexify from 'duplexify';
import * as es from 'event-stream';
import * as JSONStream from 'JSONStream';
import * as _ from 'lodash';
import * as fs from 'mz/fs';
import * as path from 'path';
import { Duplex } from 'stream';
import * as tar from 'tar-stream';

// Import hook definitions
import * as Plugin from './plugin';
import * as Utils from './utils';

export type ErrorHandler = (error: Error) => void;
const emptyHandler: ErrorHandler = () => undefined;

/**
 * This class is responsible for interfacing with the docker daemon to
 * start and monitor a build. Most use cases will require a call to
 * registerHooks(...) and a call to createBuildStream(...). Everything
 * else can be done with the hook architecture.
 *
 */
export default class Builder {
	private docker: Dockerode;
	private layers: string[];

	private constructor(docker: Dockerode) {
		this.docker = docker;
	}

	public static fromDockerode(docker: Dockerode) {
		return new Builder(docker);
	}

	public static fromDockerOpts(dockerOpts: Dockerode.DockerOptions) {
		return new Builder(
			new Dockerode(_.merge(dockerOpts, { Promise: Bluebird })),
		);
	}

	/**
	 * Start a build with the docker daemon, and return the stream to the caller.
	 * The stream can be written to, and the docker daemon will interpret that
	 * as a tar archive to build. The stream can also be read from, and the data
	 * returned will be the output of the docker daemon build.
	 *
	 * @returns A bi-directional stream connected to the docker daemon
	 */
	public createBuildStream(
		buildOpts: { [key: string]: any },
		hooks: Plugin.BuildHooks = {},
		handler: ErrorHandler = emptyHandler,
	): NodeJS.ReadWriteStream {
		const self = this;
		this.layers = [];

		// Create a stream to be passed into the docker daemon
		const inputStream = es.through<Duplex>();

		// Create a bi-directional stream
		const dup = duplexify();

		// Connect the input stream to the rw stream
		dup.setWritable(inputStream);

		Bluebird.resolve(this.docker.buildImage(inputStream, buildOpts))
			.then((res: NodeJS.ReadWriteStream) => {
				let errored = false;
				const outputStream = res
					// parse the json objects
					.pipe(JSONStream.parse())
					// Don't use fat-arrow syntax here, to capture 'this' from es
					.pipe(
						es.through<Duplex>(function(data: any): void {
							if (data == null) {
								return;
							}
							if (data.error) {
								errored = true;
								dup.destroy(new Error(data.error));
							} else {
								// Store image layers, so that they can be deleted by the caller
								// if necessary
								const sha = Utils.extractLayer(data.stream);
								if (sha !== undefined) {
									self.layers.push(sha);
								}

								this.emit('data', data.stream);
							}
						}),
					);

				// Catch any errors the stream produces
				outputStream.on('error', (err: Error) => {
					errored = true;
					self.callHook(hooks, 'buildFailure', handler, err, self.layers);
				});
				dup.on('error', (err: Error) => {
					errored = true;
					self.callHook(hooks, 'buildFailure', handler, err, self.layers);
				});

				// Setup the buildSuccess hook. This handler is not called on
				// error so we can use it to propagate the success information
				outputStream.on('end', () => {
					if (!errored) {
						this.callHook(
							hooks,
							'buildSuccess',
							handler,
							_.last(this.layers),
							this.layers,
						);
					}
				});
				// Connect the output of the docker daemon to the duplex stream
				dup.setReadable(outputStream);
			})
			.catch((err: Error) => {
				// Call the plugin's error handler
				self.callHook(hooks, 'buildFailure', handler, err, self.layers);
			});

		// Call the correct hook with the build stream
		this.callHook(hooks, 'buildStream', handler, dup);
		// and also return it
		return dup;
	}

	/**
	 * Given a path, this function will create a tar stream containing all of the files,
	 * and stream it to the docker daemon. It will then return a stream connected to
	 * the output of the docker daemon.
	 *
	 * @param dirPath Directory path to send to the docker daemon
	 * @param buildOpts Build options to pass to the docker daemon
	 *
	 * @returns Promise of a stream connected to the docker daemon
	 */
	public buildDir(
		dirPath: string,
		buildOpts: { [key: string]: any },
		hooks: Plugin.BuildHooks,
		handler: ErrorHandler = emptyHandler,
	): Bluebird<NodeJS.ReadableStream> {
		const pack = tar.pack();

		return Utils.directoryToFiles(dirPath)
			.map((file: string) => {
				// Work out the relative path
				const relPath = path.relative(path.resolve(dirPath), file);
				return Bluebird.all([relPath, fs.stat(file), fs.readFile(file)]);
			})
			.map((fileInfo: [string, fs.Stats, Buffer]) => {
				return Bluebird.fromCallback(callback =>
					pack.entry(
						{ name: fileInfo[0], size: fileInfo[1].size },
						fileInfo[2],
						callback,
					),
				);
			})
			.then(() => {
				// Tell the tar stream we're done
				pack.finalize();
				// Create a build stream to send the data to
				const stream = this.createBuildStream(buildOpts, hooks, handler);
				// Write the tar archive to the stream
				pack.pipe(stream);
				// ...and return it for reading
				return stream;
			});
	}

	/**
	 * Internal function to call a hook, if it has been registered for the build.
	 *
	 * @param args The arguments to pass to the hook. The values will be
	 * unwrapped before being passed to the callback.
	 *
	 * @returns Promise that resolves to the return value of the hook function,
	 * or to undefined if the a hook function is not provided.
	 */
	private callHook(
		hooks: Plugin.BuildHooks,
		hook: Plugin.ValidHook,
		handler: ErrorHandler,
		...args: any[]
	): Bluebird<any> {
		if (hook in hooks) {
			try {
				// Spread the arguments onto the callback function
				const fn = hooks[hook];
				if (_.isFunction(fn)) {
					const val = fn.apply(null, args);
					// If we can add a catch handler
					if (val != null && _.isFunction(val.catch) && _.isFunction(handler)) {
						val.catch(handler);
					}
					return val;
				}
			} catch (e) {
				if (_.isFunction(handler)) {
					handler(e);
				}
			}
		}
		return Bluebird.resolve();
	}
}
