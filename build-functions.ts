import { readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync, unlinkSync, symlinkSync, rmSync, cpSync, statSync, PathLike } from 'fs';
import { homedir } from 'os';
import chalk from 'chalk';
import prompts from 'prompts'
import { execSync } from 'child_process';
import semver, { SemVer } from 'semver'
import archiver from 'archiver'
import path from 'path';

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
export function loadJson(filePath: string): { version: string | null; name: string | null; } {
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
					value: false,
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
  if (semver.valid(version)) {
    ({ version } = await prompts(
      {
        type: "text",
        name: "version",
        message: version ? "Version" : "Custom Version",
        initial: version ? version : "1.0.0",
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

export async function getNextVersion(currentVersion: string): Promise<string> {
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
const changelogRegex = /-{99}\n(?<content>Version: (?<version>\d\.\d\.\d)\nDate: (?<date>(?<day>[0-2]?[0-9]|3[0-1])[./-](?<month>1[0-2]|0?[0-9])[./-](?<year>\d+))\n((?!-{99}).+\n?)+)"/gm

async function editPatchNotes(version: string, currentPatchnotes?: string): Promise<string> {
  const date = new Date;
  const { patchNotes } = await prompts(
    {
      type: "text",
      name: "patchNotes",
      message: `Please provide the patch notes for v${version}`,
      initial: `---------------------------------------------------------------------------------------------------
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
  let parsedChangelog = changelogRegex.exec(changelog);  
  if (!parsedChangelog) {
    console.log(`Valid patch notes for v${version} not found in changelog.txt`)
    parsedChangelog = changelogRegex.exec(await editPatchNotes(version))
  }
  else {
    console.log(chalk.green(`Patch notes for v${version} found in changelog.txt`))
  }
  console.log('Current Patchnotes:\n',parsedChangelog)
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
