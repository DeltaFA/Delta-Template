import yargs from 'yargs';
import { hideBin } from 'yargs/helpers'
import { readFileSync, writeFileSync } from 'fs';
import semver from 'semver'
import chalk from 'chalk'
import path from 'path';
import { build, BuildParams, getBuildMethod, getDestination, getPatchNotes, getVersion, launchFactorioPrompt, loadJson, Release, resolveFactorioPath, savePatchNotes } from './build-functions';
import { generateKey } from 'crypto';

console.log(chalk.cyan("Initializing build script v2"));

//Args
interface Args {
	dir: string | null,
	build: "zip" | "folder" | "symlink" | null,
	version: string | null,
	skipVersion: boolean,
	release: boolean,
	quiet: boolean,
	launch: boolean,
	patchNotes: boolean 
}
const argv = yargs(hideBin(process.argv))
	.version(false)
	.usage('Usage: $0 [options]') // todo: add better usage
	.option('dir', {
		alias: 'd',
		describe: 'Specify the directory: "dist" (default), "factorio", or a custom path',
		choices: ['dist', 'factorio'] as const,
		type: 'string',
		coerce: (input) => {
			switch (input) {
				case 'dist':
					return './dist';
				case 'factorio':
					return resolveFactorioPath();
				default:
					return path.resolve(input)
			}
		}
	})
	// `build` argument: restricts to specific options
	.option('build', {
		alias: 'b',
		describe: 'Build type: "zip" (default), "folder", or "symlink"',
		choices: ['zip', 'folder', 'symlink'] as const,
		type: 'string',
	})
	.option('version', {
		alias: 'v',
		describe: 'Build version: semver compliant version; default is the version in info.json',
		type: 'string',
		coerce: (input) => {
				if (semver.valid(input)) {
						return input
				}
				console.error(chalk.red("Invalid version!"))
				process.exit(1);
		}
	}
	)
	// Boolean flags: `skipVersion`, `release`, `quiet`, and `launch`
	.option('skipVersion', {
		alias: 's',
		describe: 'Skip version checks',
		type: 'boolean',
		default: false,
	})
	.option('release', {
		alias: 'r',
		describe: 'Enable release build',
		type: 'boolean',
		default: false,
	})
	.option('quiet', {
		alias: 'q',
		describe: 'Suppress user input',
		type: 'boolean',
		default: false,
	})
	.option('launch', {
		alias: 'l',
		describe: 'Launch the project after build',
		type: 'boolean',
		default: false,
	})
	.option('patchNotes', {
		alias: 'p',
		describe: 'Generate patch_notes.txt from the changelog entry',
		type: 'boolean',
		default: false,
	})
	.parse() as Args

// Define json  && changelog paths
const packagePath = "package.json";
const infoPath = "./src/info.json";
const changelogPath = "./src/changelog.txt";

// Load jsons
const packageJson = loadJson(packagePath);
const infoJson = loadJson(infoPath);

// Load changelog
const changelog = readFileSync(changelogPath, 'utf-8');

// Define build parameters
const buildParams:BuildParams = {
	dir: argv.release || argv.quiet ? './dist' : argv.dir ?? await getDestination(),
	method: argv.release || argv.quiet ? `zip` : argv.build ?? await getBuildMethod(),
	version: argv.version ?? ( argv.quiet || argv.skipVersion) ? infoJson.version ?? await getVersion('0.0.0') : await getVersion(infoJson.version!),
	name: infoJson.name,
	patchNotes: argv.patchNotes
}
const launch = argv.launch ? true : argv.quiet || argv.release ? false : argv.dir == './dist' ? false : await launchFactorioPrompt();
const release = argv.release
const patchNotes = release ? await getPatchNotes(changelog, buildParams.version) : null

// Update mod data
packageJson.name = infoJson.name;
packageJson.version = buildParams.version;
infoJson.version = buildParams.version;

// Update Jsons
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
writeFileSync(infoPath, `${JSON.stringify(infoJson, null, 2)}\n`);

// Update changelog
if (patchNotes && patchNotes.groups) savePatchNotes(changelog, patchNotes.groups.content, patchNotes.groups.version)

// Build
if (!release) {
	try {
		await build(buildParams, changelog)
	} catch (error) {
		console.error(chalk.red(error))
		process.exit(1)
	}
}

// Release
if (release) if (patchNotes && patchNotes.groups) {
	Release(buildParams, patchNotes.groups.version)
} else (console.error(chalk.red("Patch notes could not be loaded")))

console.log(chalk.cyan("Goodbye"))
