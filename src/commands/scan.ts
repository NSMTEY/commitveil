import { collect, repositoryRoot } from "../git/collect.js";
import { loadPolicy } from "../policy/config.js";
import { report } from "../reporters/report.js";
import { evaluate } from "../rules/evaluate.js";
export function scan(
  path: string,
  json: boolean,
  reveal: boolean,
): { output: string; code: number } {
  const root = repositoryRoot(path);
  const policy = loadPolicy(root);
  const data = collect(root);
  const findings = evaluate(data, policy);
  return {
    output: report(
      data.commits.length,
      findings,
      json,
      reveal,
      data.tags.length,
    ),
    code: findings.length ? 1 : 0,
  };
}
