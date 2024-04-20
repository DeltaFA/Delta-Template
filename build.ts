import { readFileSync, writeFileSync, mkdirSync, createWriteStream, existsSync, unlinkSync } from 'fs';
import semver from 'semver'
import chalk from 'chalk'
import prompts from 'prompts'
import archiver from 'archiver'

// Flags
const verCheck = process.argv.includes('--skip-version')? false : true;
const dev = process.argv.includes('--dev')? true : false;

// Define file paths
const manifestPath = "manifest.json";
const packagePath = "package.json";
const infoPath = "./src/info.json";
const archivePath = dev ? "%appdata%/Factorio/mods" : "./dist";
console.log(dev);
console.log(archivePath);

// Function for handling cancellation
function onCancel(): void {
  console.log(chalk.red("Aborting"));
  process.exit(128); // SIGINT
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

// Load manifest and package JSON files
let manifest;
let Package;
try {
  manifest = loadJson("manifest", manifestPath);
  Package = loadJson("package", packagePath);
} catch (error) {
  // Handle potential errors during JSON loading here
  console.error(chalk.red("Error loading manifest or package JSON:", error.message));
  process.exit(1);
}

let info;
try {
  info = loadJson("info", infoPath); // bruh
} catch (error) {
  console.warn(chalk.yellow("Error loading info.json:", error.message));
  info = {};
}


(async () => {
  const { version } = manifest;
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
    manifest.version = nextVersion;
    Package.version = nextVersion;
    info.version = nextVersion;

  }
  // Name check
  const { name } = manifest;
  Package.name = name;
  info.name = name;
  
  // Update Jsons
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(packagePath, `${JSON.stringify(Package, null, 2)}\n`);
  writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);

  const zipName = `${name}_${version}`;
  const nextZipName = `${name}_${nextVersion}`;
  if (!existsSync("./dist")) mkdirSync("./dist");
  if (existsSync(`${archivePath}/${zipName}.zip`)) unlinkSync(`${archivePath}/${zipName}.zip`)
  if (existsSync(`${archivePath}/${nextZipName}.zip`)) unlinkSync(`${archivePath}/${nextZipName}.zip`)
  console.log(`Archiving ${nextZipName}.zip...`);
  const output = createWriteStream(`${archivePath}${nextZipName}.zip`);
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
})();
