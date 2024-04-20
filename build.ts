import { readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync, unlinkSync } from 'fs';
import semver from 'semver'
import chalk from 'chalk'
import prompts from 'prompts'
import archiver from 'archiver'
import path from 'path';
import { execSync } from 'child_process';

// Flags
const verCheck = process.argv.includes('--skip-version')? false : true;
const dev = process.argv.includes('--dev')? true : false;
const release = process.argv.includes('--release')? true : false;
// Define file paths
const packagePath = "package.json";
const infoPath = "./src/info.json";
const archivePath = dev ? path.join(`${process.env.APPDATA}`, '/Factorio/mods') : "./dist";
console.log(archivePath);
// Function for handling cancellation
function onCancel(): void {
  console.log(chalk.red("Aborting"));
  process.exit(128); // SIGINT
}
function runCommand(command: string, exit = true): string {
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
function loadJson(name: string, path: string): any {
  try {
    const jsonText = readFileSync(path, "utf8");
    return JSON.parse(jsonText);
  } catch (error) {
    console.error(chalk.red(`${name}.json is not valid JSON: ${error.message}`));
    process.exit(1);
  }
}

// Function for confirmation prompt with error handling
async function confirmOrExit(message: string, initial = true): Promise<void> {
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

// Load info and package JSON files
let info;
let Package;
try {
  info = loadJson("info", infoPath);
  Package = loadJson("package", packagePath);
} catch (error) {
  // Handle potential errors during JSON loading here
  console.error(chalk.red("Error loading info or package JSON:", error.message));
  process.exit(1);
}

(async () => {
  const { version } = info;
  let nextVersion;
  const isValidSemver = Boolean(semver.valid(version));
  if (!isValidSemver) {
    console.error(chalk.red(`Version ${version} is not a valid semver.`));
    process.exit(1);
  }
  if (verCheck) {
    const nextPatch = semver.inc(version, "patch");
    const nextMinor = semver.inc(version, "minor");
    const nextMajor = semver.inc(version, "major");
  
    ({ nextVersion } = await prompts(
      {
        type: "select",
        name: "nextVersion",
        message: "Version",
        choices: [
          {
            title: `Current: v${version}`,
            value: version,
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
      { onCancel },
    ));
  }
  else
  {
    nextVersion = version;
  }
  if (!nextVersion) {
    ({ nextVersion } = await prompts(
      {
        type: "text",
        name: "nextVersion",
        message: isValidSemver ? "Custom Version" : "Version",
        validate: (value) => {
          if (!value.trim()) return "Version is required";
  
          return true;
        },
      },
      { onCancel },
    ));
  }
  nextVersion = nextVersion.trim();
  const isNewValidSemver = Boolean(semver.valid(nextVersion));
  console.log(nextVersion);
  // Semver Check
  if (verCheck) {
    if (isNewValidSemver) {
      if (semver.lte(nextVersion, version)) {
        await confirmOrExit(`Version ${nextVersion} is not greater than ${version}. Continue?`);
      }
      const cleaned = semver.clean(nextVersion);
      if (cleaned !== nextVersion) {
        let { clean } = await prompts({
          type: "confirm",
          name: "clean",
          message: `Convert ${nextVersion} to cleaned version ${cleaned}?`,
          initial: true,
        });
        if (clean) nextVersion = cleaned;
      }
    } else {
      console.error(chalk.red(`Version ${nextVersion} is not a valid semver.`));
      process.exit(1);
    }}
  // Version check
  if (verCheck) {
    info.version = nextVersion;
    Package.version = nextVersion;
  }
  // Name check
  const { name } = info;
  Package.name = name;

  // Update Jsons
  writeFileSync(packagePath, `${JSON.stringify(Package, null, 2)}\n`);
  writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);

  if (release) {
    runCommand("git add ./src/info.json package.json ");
    const { message } = await prompts(
      {
        type: "text",
        name: "message",
        message: "Commit message",
        initial: `Release v${info.version}`,
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
        initial: `v${info.version}`,
        validate: (value) => {
          if (!value.trim()) return "Tag name is required";
          if (existingTags.includes(value)) return `Tag ${value} already exists`;
          return true;
        },
      },
      { onCancel },
    );
    const hasSigningKey = Boolean(runCommand("git config --get user.signingkey", false).trim());
    const commitSigningEnabled =
    runCommand("git config --get commit.gpgsign", false).trim() === "true";
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
  }
  else {
    const zipName = `${name}_${version}`;
    const nextZipName = `${name}_${nextVersion}`;
    if (!existsSync("./dist")) mkdirSync("./dist");
    if (existsSync(`${archivePath}/${zipName}.zip`)) unlinkSync(`${archivePath}/${zipName}.zip`)
    if (existsSync(`${archivePath}/${nextZipName}.zip`)) unlinkSync(`${archivePath}/${nextZipName}.zip`)
    console.log(`Archiving ${nextZipName}.zip...`);
    const output = createWriteStream(`${archivePath}/${nextZipName}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err) => {
        throw err;
    });
    
    output.on('close', () => {
      console.log(`${archive.pointer()} total bytes archived.`);
    });
    
    archive.pipe(output);
    archive.directory(`./src`, `${nextZipName}`);
    archive.finalize();
    if (dev) {
      readFileSync(`${archivePath}/`)
    }
  }
})();


