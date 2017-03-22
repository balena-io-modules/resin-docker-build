const gulp = require('gulp')
const gutil = require('gulp-util')
const gclean = require('gulp-clean')
const typescript = require('gulp-typescript')
const sourcemaps = require('gulp-sourcemaps')
const gmocha = require('gulp-mocha')
const tsnode = require('ts-node/register')
const tsProject = typescript.createProject('tsconfig.json')

const OPTIONS = {
	dirs: {
		sources: './src',
		build: './build'
	}
}

gulp.task('test', () => {
	gulp.src('tests/tests.ts')
		.pipe(gmocha({
			compilers: [
				'ts:ts-node/register'
			]
		}))
})

gulp.task('clean', () => {
	return gulp.src(OPTIONS.dirs.build, { read: false })
		.pipe(gclean())
})

gulp.task('typescript', () => {
	tsProject.src()
	.pipe(sourcemaps.init())
	.pipe(tsProject()).on('error', gutil.log)
	.pipe(sourcemaps.write('./', {
		includeContent: true,
		sourceRoot: OPTIONS.dirs.sources,
		rootDir: '.'
	}))
	.pipe(gulp.dest(OPTIONS.dirs.build))
})

gulp.task('build', ['typescript'])
gulp.task('default', ['build'])
