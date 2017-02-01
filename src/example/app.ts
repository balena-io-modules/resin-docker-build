const tar = require('tar-stream')
const fs = require('fs')

import * as _ from 'lodash'

import Builder from '../index'
import { IBuildHooks } from '../plugin'
import { ProjectType } from './project-type'

/**
 * Given an input tar stream, this function will resolve Dockerfile.template
 * and package.json projects into a format that docker can understand
 *
 * @returns {ReadableStream}
 *	A stream which when read, produces the project tar archive
 */
const getProjectStream = (inputStream: NodeJS.ReadableStream) : NodeJS.ReadableStream => {
	let extract = tar.extract()
	let pack = tar.pack()

	let proj = new ProjectType()
	// Setup handling functions
	extract.on('entry', (header: Object, stream: NodeJS.ReadWriteStream, next: () => void) => {
		// If the project type handler does not require the file,
		// add it to the archive unchanged
		if (!proj.provideEntry(stream, header)) {
			// Add it to the new tar archive
			stream.pipe(pack.entry(header, next))
		} else {
			// Move on to the next file
			next()
		}

	})

	extract.on('finish', () => {
		let data = proj.getDockerfile()
		pack.entry({ name: 'Dockerfile' }, data)
		pack.finalize()
	})

	// Send the old tar archive to be unpacked
	inputStream.pipe(extract)

	return pack
}

let hooks: IBuildHooks = {
	buildSuccess: (imageId: string, layers: string[]) : void => {
		console.log('Success hook is being called')
		console.log(`Image Id: ${imageId}`)
		console.log(`Image layers: ${JSON.stringify(layers, null, '  ')}`)
	},

	buildFailure: (error: Error) : void => {
		console.error(`Error! Reason: ${error}`)
	},

	buildStream: (stream: NodeJS.ReadWriteStream) : void => {
		// Connect the output of the stream to the user's output
		stream.on('data', (data: Buffer) => {
			console.log(data.toString().trim())
		})

		// pull in a tar archive as a stream
		let iStream = fs.createReadStream('./archive.tar')

		// Initialise the input stream, after detecting template types
		let tarStream = getProjectStream(iStream)
		tarStream.pipe(stream)
	}
}

let builder = new Builder('/var/run/docker.sock')
builder.registerHooks(hooks)

// Initialise a build stream
builder.createBuildStream({})
