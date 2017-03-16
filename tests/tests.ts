import * as mocha from 'mocha'

import * as fs from 'fs'

import Builder from '../src/index'
import { BuildHooks } from '../src/plugin'

// In general we don't want output, until we do.
// call with `env DISPLAY_TEST_OUTPUT=1 npm test` to display output
const dockerPath = process.env.DOCKER_PATH || '/var/run/docker.sock'
const displayOutput = process.env.DISPLAY_TEST_OUTPUT === '1'

// Most of the time we just care that the correct hooks are being called
// define them here to make it slightly easier
//
// sucessHooks: for when we want the buildSuccess hook to be called
const getSuccessHooks = (done: Function): BuildHooks => {
	const hooks: BuildHooks = {
		buildSuccess: (id, layers) => {
			done()
		},
		buildFailure: (err) => {
			if (displayOutput) {
				console.log(err)
			}
			done(err)
		}
	}
	return hooks
}
// failureHooks: for when we want the failure hook to be called
const getFailureHooks = (done: Function): BuildHooks => {
	const hooks: BuildHooks = {
		buildSuccess: (id, layers) => {
			done(new Error('Expected error, got success'))
		},
		buildFailure: (err) => {
			if (displayOutput) {
				console.log(err)
			}
			done()
		}
	}
	return hooks
}

describe('Directory build', () => {
	it('should build a directory image', function(done) {
		// Give the build 60 seconds to finish
		this.timeout(60000)
		// Start a directory build
		const builder = new Builder({ socketPath: dockerPath })
		const hooks = getSuccessHooks(done)

		builder.buildDir('tests/test-files/directory-successful-build', {}, hooks)
		.then((stream) => {
			if (displayOutput) {
				stream.pipe(process.stdout)
			}
		})
	})

	it('should fail to build a directory without Dockerfile', function(done) {
		this.timeout(30000)

		const builder = new Builder({ socketPath: dockerPath })
		const hooks = getFailureHooks(done)

		builder.buildDir('tests/test-files/directory-no-dockerfile', {}, hooks)
		.then((stream) => {
			if (displayOutput) {
				stream.pipe(process.stdout)
			}
		})

	})

	it('should fail with invalid Dockerfile', function(done) {
		this.timeout(30000)

		const builder = new Builder({ socketPath: dockerPath })
		const hooks = getFailureHooks(done)

		builder.buildDir('tests/test-files/directory-invalid-dockerfile', {}, hooks)
		.then((stream) => {
			if (displayOutput) {
				stream.pipe(process.stdout)
			}
		})
	})

	it('should pass stream to caller on successful build', function(done) {
		// Shorter timeout for this test, as a timeout is the failure marker
		this.timeout(10000)
		const hooks: BuildHooks = {
			buildStream: (stream) => {
				if (displayOutput) {
					stream.pipe(process.stdout)
				}
				done()
			}
		}

		const builder = new Builder({ socketPath: dockerPath })
		builder.buildDir('tests/test-files/directory-successful-build', {}, hooks)

	})

	it('should pass stream to caller on unsuccessful build', function(done) {
		this.timeout(10000)
		const hooks: BuildHooks = {
			buildStream: (stream) => {
				if (displayOutput) {
					stream.pipe(process.stdout)
				}
				done()
			}
		}

		const builder = new Builder({ socketPath: dockerPath })
		builder.buildDir('tests/test-files/directory-invalid-dockerfile', {}, hooks)

	})
})

describe('Tar stream build', () => {
	it('should build a tar stream successfully', function(done) {
		this.timeout(60000)

		const tarStream = fs.createReadStream('tests/test-files/archives/success.tar')

		const hooks: BuildHooks = {
			buildStream: (stream) => {
				tarStream.pipe(stream)
				if (displayOutput) {
					stream.pipe(process.stdout)
				}
			},
			buildSuccess: (id, layers) => {
				done()
			},
			buildFailure: (err) => {
				if (displayOutput) {
					console.log(err)
				}
				done(err)
			}
		}

		const builder = new Builder({ socketPath: dockerPath })
		builder.createBuildStream({}, hooks)
	})

	it('should fail to build invalid tar stream', function(done) {
		this.timeout(60000)

		const tarStream = fs.createReadStream('tests/test-files/archives/failure.tar')

		const hooks: BuildHooks = {
			buildStream: (stream) => {
				tarStream.pipe(stream)
				if (displayOutput) {
					stream.pipe(process.stdout)
				}
			},
			buildSuccess: (id, layers) => {
				done(new Error('Expected build failure, got success hook'))
			},
			buildFailure: (err) => {
				if (displayOutput) {
					console.log(err)
				}
				done()
			}
		}

		const builder = new Builder({ socketPath: dockerPath })
		builder.createBuildStream({}, hooks)

	})
})

