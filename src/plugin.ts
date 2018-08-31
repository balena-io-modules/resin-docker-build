/**
 * ValidHooks: A list of valid hooks to enable the compiler to do
 * some safety checking
 */
export type ValidHook = 'buildStream'
                      | 'buildSuccess'
                      | 'buildFailure'

/**
 * BuildHooks
 *
 * This interface details the hooks that *can* be implemented by a `resin-docker-build` plugin.
 * No callbacks are required to be provided and in that case the build will continue as normal,
 * with the caveat of there will be no caching and output. It also would not be possible to tell
 * when/if the build finished successfully.
 *
 * Because of this the minimum recommended registered hooks are buildSuccess and buildFailure,
 * but this is not enforced, or required.
 */
export interface BuildHooks {
	/**
	 * This hook is called after a build is started, with `stream` being populated with
	 * a ReadableStream which is connected to the output of the docker daemon.
	 *
	 * @param {NodeJS.ReadWriteStream} stream
	 *	A duplex stream which can be used to send and recieve data with the
	 *	docker daemon.
	 *
	 *
	 * Example implementation:
	 *
	 * buildStream = (stream) => {
	 *	stream.pipe(process.stdout)
	 * }
	 *
	 */
	buildStream?: (stream: NodeJS.ReadWriteStream) => void

	/**
	 * This hook will be called after a build has successfully finished.
	 *
	 * @param {string} imageId
	 *	This parameter will be populated with the digest which points to the
	 *	built image.
	 * @param {string[]} layers
	 *	Intermediate layers used by the build, can be used for GC. The last
	 *	id in the layers array is also the imageId, so care should be taken to
	 *	not GC the built image.
	 */
	buildSuccess?: (imageId: string, layers: string[]) => void

	/**
	 * This hook will be called upon build failure, with the error that caused
	 * the failure.
	 *
	 * @param {Error} error
	 *	The error which caused the build failure
	 *
	 * @param {string[]} layers
	 *	The layer which were successful
	 */
	buildFailure?: (error: Error, layers: string[]) => void
}
