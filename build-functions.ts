import { readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync, symlinkSync, rmSync, cpSync, statSync, readdirSync } from 'fs';
import { homedir } from 'os';
import chalk from 'chalk';
import prompts from 'prompts'
import { execSync } from 'child_process';
import semver from 'semver'
import archiver from 'archiver'
import path from 'path';
import cliSpinners from 'cli-spinners';
import ora from 'ora';

export interface BuildParams {
	dir: string,
	method: string,
	version: string,
	name: string,
	patchNotes: boolean
}
// Function for handling cancellation
function onCancel(): void {
	console.log(chalk.red("Aborting"));
	process.exit(128); // SIGINT
}

export function runCommand(command: string, exit = true): string {
	try {
		const result = execSync(command, {
			encoding: "utf8",
			cwd: process.cwd(),
		});
		return result;
	} catch (error) {
		if (!exit) return error.stdout;
		console.error(error.message);
		process.exit(1);
	}
}

// Function to load JSON files with error handling
export function loadJson(filePath: string): any {
	try {
		const jsonText = readFileSync(filePath, "utf8");
		return JSON.parse(jsonText);
	} catch (error) {
		console.error(chalk.red(`${path.basename(filePath)}.json is not valid JSON: ${error.message}`));
		process.exit(1);
	}
}

// Function to load JSON files with error handling
export function loadTxt(filePath: string) {
	try {
		const data = readFileSync(filePath, "utf-8");
		return data
	} catch (error) {
		console.error(chalk.red(`${path.basename(filePath)}.txt is not valid TEXT file: ${error.message}`));
		process.exit(1);
	}
}

// Function for confirmation prompt with error handling
async function confirmOrExit(message: string, initial = false): Promise<void> {
	try {
		const { doContinue } = await prompts(
			{
				type: "confirm",
				name: "doContinue",
				message: chalk.yellow(message),
				initial,
			},
			{ onCancel },
		);

		if (!doContinue) {
			console.log(chalk.red("Aborting"));
			process.exit(0);
		}
	} catch (error) {
		console.error(chalk.red("Error during confirmation prompt:", error.message));
		process.exit(1);
	}
}

export async function getDestination(): Promise<string> {

	let destPath: string | null;
	({ destPath } = await prompts(
		{
			type: "select",
			name: "destPath",
			message: "Destination folder",
			choices: [
				{
					title: `Factorio mods folder`,
					value: process.platform === "win32" ? path.join(`${process.env.APPDATA}`, '/Factorio/mods') :  path.join("~/.factorio/mods"),
				},
				{
					title: `./dist`,
					value: "./dist",
				},
				{
					title: 'custom',
					value: null,
				}
			],
		},
		{ onCancel }
	));
	if (!destPath) {
		({destPath} = await prompts(
			{
				type: "text",
				name: "destPath",
				message: "Please provide a path",
				initial: homedir(),
				validate: value => existsSync(value) ? true : "Path not valid" 
			}
			
		))
	}
	console.log(`Export path: ${destPath}`);
	return destPath as string;
}

export async function getBuildMethod(): Promise<string> {
	let buildMethod: string
	({ buildMethod } = await prompts(
		{
			type: "select",
			name: "buildMethod",
			message: "Build method",
			choices: [
				{
					title: `Zip`,
					value: `zip`,
				},
				{
					title: `Folder`,
					value: `folder`,
				},
				{
					title: `Symlink [Requires admin]`,
					value: `symlink`,
				}
			],
		},
		{ onCancel },
	));
	return buildMethod;
}

export async function validateVersion(version: string | null, ): Promise<string> {
	// Check if version exists
	if (!semver.valid(version)) {
		({ version } = await prompts(
			{
				type: "text",
				name: "version",
				message: version ? "Version" : "Custom Version",
				initial: version ?? "1.0.0",
				validate: value => semver.valid(value) ? true : `Version ${value} is not a valid semver.`
			},
			{ onCancel },
		));
	}
	version = version as string
	// Version Cleanup
	const cleaned = semver.clean(version);
	if (cleaned !== version) {
		let { clean } = await prompts({
			type: "confirm",
			name: "clean",
			message: `Convert ${version} to cleaned version ${cleaned}?`,
			initial: true,
		});
		if (clean) version = cleaned;
	}
	return version as string
}

export async function getVersion(currentVersion: string): Promise<string> {
	const validatedCurrentVersion = await validateVersion(currentVersion)
	if (validatedCurrentVersion !== currentVersion) {
		return validatedCurrentVersion
	}
	const nextPatch = semver.inc(currentVersion, "patch");
	const nextMinor = semver.inc(currentVersion, "minor");
	const nextMajor = semver.inc(currentVersion, "major");
	let nextVersion: string | null;
	({ nextVersion } = await prompts(
		{
			type: "select",
			name: "nextVersion",
			message: "Version",
			choices: [
				{
					title: `Current: v${currentVersion}`,
					value: currentVersion,
				},
				{
					title: `Patch: v${nextPatch}`,
					value: nextPatch,
				},
				{
					title: `Minor: v${nextMinor}`,
					value: nextMinor,
				},
				{
					title: `Major: v${nextMajor}`,
					value: nextMajor,
				},
				{
					title: "Custom",
					value: null,
				},
			],
		},
		{ onCancel }
	));
	nextVersion = await validateVersion(nextVersion)
	if (nextVersion && semver.lte(nextVersion, currentVersion)) {
		await confirmOrExit(`Version ${nextVersion} is not greater than ${currentVersion}. Continue?`, true);
	}
	return nextVersion
}

// Patch notes
const changelogRegex = /-{99}\n(?<content>Version: (?<version>\d+\.\d+\.\d+)\nDate: (?<date>(?<day>[0-2]?[0-9]|3[0-1])[./-] ?(?<month>1[0-2]|0?[0-9])[./-] ?(?<year>\d+))\n((?!-{99}).+\n?)+)/gm

async function editPatchNotes(version: string, currentPatchNotes?: string): Promise<string> {
	const date = new Date;
	const { patchNotes } = await prompts(
		{
			type: "text",
			name: "patchNotes",
			message: `Please provide the patch notes for v${version}`,
			initial: currentPatchNotes ?? `---------------------------------------------------------------------------------------------------
			Version: ${version}
			Date: ${date.getDay}.${date.getMonth}.${date.getFullYear}
			`,
			validate: value => changelogRegex.exec(value) ? true : "Invalid Patch Notes"
		},
		{ onCancel }
	);
	return (patchNotes as string).trim()
}
export async function getPatchNotes(changelog: string, version: string) {
	let parsedChangelog = changelogRegex.exec(changelog.replace(/\r\n/g, "\n"));  
	if (!parsedChangelog || !parsedChangelog.groups || !parsedChangelog.groups.version ) {
		console.log(`Valid patch notes for v${version} not found in changelog.txt`)
		parsedChangelog = changelogRegex.exec(await editPatchNotes(version))
	}
	else {
		console.log(chalk.green(`Patch notes for v${version} found in changelog.txt`))
		console.log('Current Patch notes:\n',parsedChangelog.groups.content)
	}
	const { correct } = await prompts(
		{
			type: "confirm",
			name: "correct",
			message: chalk.yellow("Are the Patch notes correct?"),
			initial: true
		} 
	)
	let edit: boolean | null
	if (!correct) {
		({ edit } = await prompts(
			{
				type: "confirm",
				name: "edit",
				message: chalk.yellow("Would you like to edit the Patch notes?"),
				initial: true,
			},
			{ onCancel },
		));
		if (edit) {
			parsedChangelog = changelogRegex.exec(await editPatchNotes(parsedChangelog![0]))    
		}
	};
	return parsedChangelog as RegExpExecArray
}

export function exportPatchNotes(changelog: string, version: string) {
	let parsedChangelog = changelogRegex.exec(changelog.replace(/\r\n/g, "\n"));  
	if (!parsedChangelog || !parsedChangelog.groups || !parsedChangelog.groups.version ) {
		console.log(`Valid patch notes for v${version} not found in changelog.txt`)
	}
	else {
		console.log(chalk.green(`\nPatch notes for v${version} found in changelog.txt`))
		try {
			writeFileSync('./dist/patch_notes.txt', parsedChangelog.groups.content)
		} catch (error) {
			console.error(chalk.red("Error while exporting patch notes:", error))
			process.exit(1);
		}
	}
}

export function savePatchNotes(changelog: string, patchNotes: string, version: string) {
	let parsedChangelog = changelogRegex.exec(changelog.replace(/\r\n/g, "\n"))
	if (parsedChangelog && parsedChangelog.groups && parsedChangelog.groups.version == version){
		let newChangelog = `---------------------------------------------------------------------------------------------------\n${patchNotes.trimEnd()}\n\n${changelog.trimStart()}`.trim()
		try {
			writeFileSync('./src/changelog.txt', newChangelog)
		} catch (error) {
			console.error(chalk.red("Error saving changes to the changelog:", error))
			process.exit(1);
		}
	}
}

export async function launchFactorioPrompt(): Promise<boolean> {
	const { launch } = await prompts(
		{
			type: "confirm",
			name: "launch",
			message: "Would you like to launch factorio?",
			initial: true
		},
		{ onCancel },
	);
	return launch as boolean
}
export function resolveFactorioPath(): string {
	return process.platform === 'win32' ? path.join(`${process.env.APPDATA}`, '/Factorio/mods') : path.join(`${process.env.HOME}`,`.factorio.mods`)
}

export async function build(params:BuildParams, changelog: string) {
	const nameRegex = new RegExp(`^${params.name}(_\\d\\.\\d\\.\\d)?(\\.zip)?$`)
	const spin = ora(`Building ${params.name} v${params.version}`).start()
	spin.spinner = cliSpinners.dots3
	const Path = params.method == "zip" ? path.join(params.dir, `${params.name}_${params.version}.zip`): path.join(params.dir, params.name)
	if (params.dir == "./dist" && !existsSync("./dist")) mkdirSync("./dist")
	if (params.dir == resolveFactorioPath()) {
		readdirSync(params.dir).forEach((file) => {
		if (nameRegex.exec(path.parse(file).base)) {
			rmSync(path.resolve(params.dir, file), {recursive: true});
		}});
	}
	switch (params.method) {
		case "zip":
			const output = createWriteStream(Path);
			const archive = archiver('zip', { zlib: { level: 9 } });
			archive.on('error', (err) => {
					throw err;
			});
			output.on('close', () => {
				console.log(`${archive.pointer()} total bytes archived.`);
			});
			archive.pipe(output);
			archive.directory(`./src`, `${params.name}_${params.version}`);
			await archive.finalize();
			break;
		case "folder":
			cpSync("./src", Path, {recursive: true});
			break;
		case "symlink":
			symlinkSync(path.resolve(`./src`), Path, 'dir')
			break;
		default:
			console.error(chalk.red(`Invalid build method: ${params.method}`))
			process.exit(1);
	}
	if (params.patchNotes) exportPatchNotes(changelog, params.version)
	spin.stop()
	console.log(chalk.green("Build complete!"))
	return 0
}

export async function Release(params:BuildParams, version: string) {
	console.log(chalk.bold("Starting release..."))
	runCommand("git add ./src/info.json package.json ./src/changelog.txt");
	const { message } = await prompts(
		{
				type: "text",
				name: "message",
				message: "Commit message",
				initial: `Release v${version}`,
				validate: (value) => {
					if (!value.trim()) return "Commit message is required";
					return true;
			},
	},
	{ onCancel },
	);
	
	const existingTags = runCommand("git tag --list").split("\n").filter(Boolean);
	const { tagName } = await prompts(
		{
			type: "text",
			name: "tagName",
			message: "Tag name",
			initial: `v${params.version}`,
			validate: (value) => {
				if (!value.trim()) return "Tag name is required";
				if (existingTags.includes(value)) return `Tag ${value} already exists`;
				return true;
			},
	},
	{ onCancel },
	);
	const hasSigningKey = Boolean(runCommand("git config --get user.signingkey", false).trim());
	const commitSigningEnabled = runCommand("git config --get commit.gpgsign", false).trim() === "true";
	const tagSigningEnabled = runCommand("git config --get tag.gpgsign", false).trim() === "true";
	let sign = false;
	if (hasSigningKey && (!commitSigningEnabled || !tagSigningEnabled)) {
		({ sign } = await prompts({
			type: "confirm",
			name: "sign",
			message: "Sign commit and tag?",
			initial: true,
	}));
	}
	// Commit changes
	runCommand(`git commit${sign ? " -S" : ""} -m "${message}"`);
	// Tag commit
	runCommand(`git tag${sign ? " -s" : ""} -a -m "${message}" "${tagName}"`);
	// Push changes
	await confirmOrExit("Push changes to remote?", true);
	runCommand("git push");
	// And the tag
	runCommand("git push --tags");
	console.log(chalk.green("Release complete!"))
}
