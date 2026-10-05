import {
  accessSync,
  constants,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

function repositoryBoundary(path: string): string {
  const initial = resolve(path);
  let directory = initial;
  while (true) {
    try {
      lstatSync(join(directory, ".git"));
      return directory;
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw new Error(
          "Cannot establish the repository executable safety boundary.",
        );
    }
    try {
      if (
        statSync(join(directory, "objects")).isDirectory() &&
        statSync(join(directory, "HEAD")).isFile()
      )
        return directory;
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw new Error(
          "Cannot establish the repository executable safety boundary.",
        );
    }
    const parent = dirname(directory);
    if (parent === directory) return initial;
    directory = parent;
  }
}

// An absolute program path avoids Windows' implicit current-directory search.
// Relative/empty PATH entries and executables inside untrusted roots are ignored.
export function resolveGitExecutable(
  blockedRoots: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path =
    Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ??
    "";
  const roots = blockedRoots.map((root) => {
    root = repositoryBoundary(root);
    try {
      return realpathSync(root);
    } catch {
      return resolve(root);
    }
  });
  for (const entry of path.split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(directory)) continue;
    try {
      const candidate = realpathSync(
        join(directory, process.platform === "win32" ? "git.exe" : "git"),
      );
      if (
        roots.some((root) => {
          const part = relative(root, candidate);
          return (
            part === "" ||
            (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part))
          );
        })
      )
        continue;
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Missing/inaccessible candidates cannot be trusted executables. */
    }
  }
  throw new Error(
    "Git is unavailable on a trusted absolute PATH outside the working/scanned directories. Install Git 2.45+.",
  );
}
