import { readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync, unlinkSync, symlinkSync, rmSync, cpSync, statSync } from 'fs';
import semver from 'semver'
import chalk from 'chalk'
import prompts from 'prompts'
import archiver from 'archiver'
import path from 'path';
import { execSync } from 'child_process';
import opn from 'better-opn';


// Flags
const release = process.argv.includes('--release')? true : false;
const automated = process.argv.includes('--skip-user-input')? true : false;

let toFactorio = process.argv.includes('--to-factorio')? true : false;
let folder = process.argv.includes('--folder')? true : false;
let link = process.argv.includes('--link')? true : false;
let launch = process.argv.includes('--launch')? true : false;
let verCheck = process.argv.includes('--skip-version')? false : true;

// Define file paths
const packagePath = "package.json";
const infoPath = "./src/info.json";
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
  let buildMethod;
  let nextVersion;
  const isValidSemver = Boolean(semver.valid(version));
  if (!isValidSemver) {
    console.error(chalk.red(`Version ${version} is not a valid semver.`));
    process.exit(1);
  }

  if ( !( automated || toFactorio ) ) {
    ({ toFactorio } = await prompts(
      {
        type: "select",
        name: "toFactorio",
        message: "Destination folder",
        choices: [
          {
            title: `Factorio mods folder`,
            value: true,
          },
          {
            title: `./dist`,
            value: false,
          }
        ],
      },
      { onCancel },
    ));
  }

  const exportPath = toFactorio ? path.join(`${process.env.APPDATA}`, '/Factorio/mods') : "./dist";
  console.log(`Export path: ${exportPath}`);

  if ( !( automated || folder || link ) ) {
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

    folder = (buildMethod == `folder`) ? true : false;
    link = (buildMethod == `symlink`) ? true : false;
    verCheck = ( folder || link ) ? false : verCheck;
  }

  if (verCheck && !automated) {
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

  if ( toFactorio && !( automated || launch )) {
    ({ launch } = await prompts(
      {
        type: "select",
        name: "launch",
        message: "Launch factorio",
        choices: [
          {
            title: `Yes`,
            value: true,
          },
          {
            title: `No`,
            value: false,
          }
        ],
      },
      { onCancel },
    ));
  }

  nextVersion = nextVersion.trim();
  const isNewValidSemver = Boolean(semver.valid(nextVersion));
  console.log(nextVersion);
  // Semver Check
  if (verCheck && !automated) {
    if (isNewValidSemver) {
      if (semver.lte(nextVersion, version)) {
        await confirmOrExit(`Version ${nextVersion} is not greater than ${version}. Continue?`, true);
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
    }
  // Version check
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
    const modName = `${name}_${version}`;
    const nextModName = `${name}_${nextVersion}`;
    const modPath = `${exportPath}/${modName}`;
    const nextModPath = `${exportPath}/${nextModName}`;
    const folderPath = `${exportPath}/${name}`;
    
    if (!existsSync("./dist")) mkdirSync("./dist");
    if (existsSync(`${modPath}.zip`)) unlinkSync(`${modPath}.zip`);
    if (existsSync(`${nextModPath}.zip`)) unlinkSync(`${nextModPath}.zip`);
    if (existsSync(`${folderPath}`) && statSync(`${folderPath}`).isSymbolicLink()) unlinkSync(`${folderPath}`);
    if (existsSync(`${folderPath}`)) rmSync(`${folderPath}`, { recursive: true, force: true });
    
    if (folder) {
      console.log(`Copying the ${name} folder...`);
      cpSync(`./src`, `${folderPath}`, {recursive: true})
    }
    else if (link){
      console.log(`Linking the ${name} folder...`);
      symlinkSync(path.resolve(__dirname, `./src`), `${folderPath}`, 'dir')
    }
    else{
      console.log(`Archiving ${nextModName}.zip...`);
      const output = createWriteStream(`${nextModPath}.zip`);
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      archive.on('error', (err) => {
          throw err;
      });
      
      output.on('close', () => {
        console.log(`${archive.pointer()} total bytes archived.`);
      });
      
      archive.pipe(output);
      archive.directory(`./src`, `${nextModName}`);
      archive.finalize();
    }

    if(launch){
      console.log(`Launching Factorio...`);
      opn('steam://launch/427520')
    }
  }
})();