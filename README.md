# Resin-docker-build

[![npm version](https://badge.fury.io/js/resin-docker-build.svg)](https://badge.fury.io/js/resin-docker-build)
[![CircleCI](https://circleci.com/gh/resin-io/resin-docker-build.svg?style=svg)](https://circleci.com/gh/resin-io/resin-docker-build)

A modular, plugin-based approach to building docker containers. Resin-docker-build uses streams and
hooks to provide a system which can be added to a build pipeline easily. With a simple but flexible
interface, this module is meant to take the pain out of automating docker builds. Resin-docker-build is
written in typescript, and all defined types are exported.

## API

All building is done via the `Builder` object.

The `Builder` API has two top-level methods, which are used to trigger builds;

* `createBuildStream(buildOpts: Object, hooks: BuildHooks, handler: ErrorHandler): ReadWriteStream`

Initialise a docker daemon and set it up to wait for some streaming data. The stream is returned to the
caller for both reading and writing. Success and failure callbacks are provided via the hooks interface
(see below). `buildOpts` is passed directly to the docker daemon and the expected input by the daemon is
is a tar stream.

* `buildDir(directory: string, buildOpts: Object, hooks: BuildHooks, handler: ErrorHandler): ReadWriteStream`

Inform the docker daemon to build a directory on the host. A stream is returned for reading, and
the same success/failure callbacks apply. `buildOpts` is passed directly to the docker daemon.


* The `handler` parameter:

If an exception is thrown from within the hooks, because it is executing in a
different context to the initial api call they will not be propagated. Using
the error handler means that you can handle the error as necessary (for instance
propagate to your global catch, or integrate it into a promise chain using
`reject` as a handler). The error handler is optional. Note that the error
handler will not be called with a build error, instead with that being dropped
to the `buildFailure` hook, but if that hook throws, the handler will be called.

## Hooks

Currently the hooks supported are;

* `buildStream(stream: ReadWriteStream): void`

Called by the builder when a stream is ready to communicate directly with the daemon. This is useful
for parsing/showing the output and transforming any input before providing it to the docker daemon.

* `buildSuccess(imageId: string, layers: string[]): void`

Called by the builder when the daemon has successfully built the image. `imageId` is the sha digest provided
by the daemon, which can be used for pushing, running etc. `layers` is a list of sha digests pointing to
the intermediate layers used by docker. Can be useful for cleanup.

* `buildFailure(error: Error)`

Called by the builder when a build has failed for whatever reason. The reason is provided as a standard
node error object. This was also close the build stream. No more hooks will be called after this.

## Examples

Examples are provided in typescript.

### Directory Building

```javascript
import { Builder, BuildHooks } from 'resin-docker-build'

const builder = Builder.fromDockerOpts({ socketPath: '/var/run/docker.sock' })

const hooks: BuildHooks = {
	buildStream: (stream: NodeJS.ReadWriteStream): void => {
		stream.pipe(process.stdout)
	},
	buildSuccess: (imageId: string, layers: string[]): void => {
		console.log(`Successful build! ImageId: ${imageId}`)
	},
	buildFailure: (error: Error): void => {
		console.error(`Error building container: ${error}`)
	}
}

builder.buildDir('./my-dir', {}, hooks)
```

### Building a tar archive
```javascript
import * as fs from 'fs'
import { Builder, BuildHooks } from 'resin-docker-build'

const builder = Builder.fromDockerOpts({ socketPath: '/var/run/docker.sock' })

const getHooks = (archive: string): BuildHooks => {
	return {
		buildSuccess: (imageId: string, layers: string[]): void => {
			console.log(`Successful build! ImageId: ${imageId}`)
		},
		buildFailure: (error: Error): void => {
			console.error(`Error building container: ${error}`)
		},
		buildStream: (stream: NodeJS.ReadWriteStream): void => {
			// Create a stream from the tar archive.
			// Note that this stream could be from a webservice,
			// or any other source. The only requirement is that
			// when consumed, it produces a valid tar archive
			const tarStream = fs.createReadStream(archive)

			// Send the tar stream to the docker daemon
			tarStream.pipe(stream)

			stream.pipe(process.stdout)
		}
	}
}

builder.createBuildStream({}, getHooks('my-archive.tar'))
```
