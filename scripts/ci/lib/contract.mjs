export const REQUIRED_STAGES = ['lint', 'unit-core', 'unit-calorie-tracker', 'rules-emulator', 'api-contract',
  'browser-public', 'browser-auth', 'concurrency', 'docs-manifest', 'build-cloudflare', 'deploy-smoke'];

// The workflows deliberately use plain YAML mappings and literal needs lists.
// Rejecting unsupported shapes keeps this dependency-free parser fail-closed.
export function workflowJobs(source) {
  const jobs = {};
  const section = source.match(/^jobs:\s*\n([\s\S]*)/m)?.[1] ?? '';
  const starts = [...section.matchAll(/^  ([\w-]+):\s*$/gm)];
  for (let i = 0; i < starts.length; i++) {
    const body = section.slice(starts[i].index + starts[i][0].length, starts[i + 1]?.index ?? section.length);
    const needs = body.match(/^    needs:\s*\[([^\]]*)\]/m)?.[1];
    jobs[starts[i][1]] = { body, needs: needs === undefined ? [] : needs.split(',').map((s) => s.trim()).filter(Boolean) };
  }
  return jobs;
}
export function stageErrors(contract, workflows, now = new Date()) {
  const errors = [];
  const stages = contract.stages ?? [];
  const ids = stages.map((stage) => stage.id);
  if (contract.version !== 1 || !contract.owner) errors.push('stages: missing version or owner');
  if (ids.length !== new Set(ids).size) errors.push('stages: duplicate stage');
  for (const id of REQUIRED_STAGES) if (!ids.includes(id)) errors.push(`stages: missing ${id}`);
  for (const stage of stages) {
    if (!REQUIRED_STAGES.includes(stage.id) || !/^@[\w-]+$/.test(stage.owner ?? '') ||
      !stage.priority || !stage.source || !Array.isArray(stage.tests) || !stage.workflow) errors.push(`stages: incomplete ${stage.id}`);
    const jobs = workflowJobs(workflows[stage.workflow] ?? '');
    if (stage.status === 'blocking' || stage.status === 'post-deploy') {
      if (!jobs[stage.id]) errors.push(`stages: missing job ${stage.id}`);
      if (stage.status === 'blocking' && stage.workflow !== '.github/workflows/ci.yml') errors.push(`stages: wrong workflow ${stage.id}`);
      if (stage.status === 'post-deploy' && stage.workflow !== '.github/workflows/deploy-smoke.yml') errors.push(`stages: wrong workflow ${stage.id}`);
    } else if (stage.status === 'pending') {
      if (!/^AR-\d+$/.test(stage.followUp ?? '') || !stage.reason ||
        !/^\d{4}-\d{2}-\d{2}$/.test(stage.reviewBy ?? '') || !(new Date(`${stage.reviewBy}T23:59:59Z`) > now)) errors.push(`stages: invalid pending ${stage.id}`);
      if (Object.values(workflows).some((workflow) => workflowJobs(workflow)[stage.id])) errors.push(`stages: pending job ${stage.id}`);
    } else errors.push(`stages: invalid status ${stage.id}`);
  }
  const blocking = stages.filter((stage) => stage.status === 'blocking').map((stage) => stage.id).sort();
  const needs = workflowJobs(workflows['.github/workflows/ci.yml'] ?? '')['ci-gate']?.needs ?? [];
  if (JSON.stringify([...needs].sort()) !== JSON.stringify(blocking)) errors.push('stages: ci-gate needs must equal blocking stages');
  return errors;
}
export function ownershipErrors(files, stages) {
  return files.filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file)).flatMap((file) => {
    const matches = stages.filter((stage) => (stage.tests ?? []).some((pattern) => new RegExp(pattern).test(file)));
    return matches.length === 1 ? [] : [`ownership: ${file} has ${matches.length} owners`];
  });
}
export function calorieErrors(files, script) {
  const listed = new Set(script.split(/\s+/));
  return files.filter((file) => /^public\/tools\/CalorieTracker\/.*\.test\.js$/.test(file))
    .filter((file) => !listed.has(file.replace('public/tools/CalorieTracker/', '')))
    .map((file) => `calorie-list: ${file}`);
}
export function quarantineErrors(quarantine, sources, stages, now = new Date()) {
  const errors = [], warnings = [], used = new Set(), ids = new Set();
  if (quarantine.version !== 1 || quarantine.maxDays !== 30 || !Array.isArray(quarantine.entries)) return { errors: ['quarantine: invalid manifest'], warnings };
  for (const entry of quarantine.entries) {
    const added = Date.parse(`${entry.added}T00:00:00Z`), expires = Date.parse(`${entry.expires}T00:00:00Z`);
    if (!entry.id || ids.has(entry.id) || !stages.some((stage) => stage.id === entry.stage) ||
      !entry.test || !/^@[\w-]+$/.test(entry.owner ?? '') || !entry.reason ||
      !/^https:\/\/github\.com\/ferynd\/Website\/issues\/[1-9]\d*$/.test(entry.issue ?? '') ||
      !Number.isFinite(added) || !Number.isFinite(expires) || added > now.getTime() || expires <= now.getTime() ||
      expires <= added || expires - added > 30 * 86400000) errors.push(`quarantine: incomplete or expired ${entry.id ?? '(missing id)'}`);
    ids.add(entry.id);
  }
  for (const [file, source] of Object.entries(sources)) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // Ignore comments and quoted fixture strings; inspect test API call expressions.
      const line = lines[i].trim();
      if (/^(?:\/\/|\*|\/\*)/.test(line)) continue;
      const call = /\b(?:it|test|describe|suite)(?:\s*\.\s*\w+(?:\([^;]*?\))?)*\s*\.\s*(only|skip|skipIf|todo|fails)\b|\b(xit|xdescribe)\s*\(/g;
      for (const match of line.matchAll(call)) {
        // A string literal containing a synthetic call isn't executable suppression.
        const prefix = line.slice(0, match.index);
        if (/['"`]/.test(prefix.replace(/\b(?:export|const|let|var|async)\b/g, ''))) continue;
        if (match[1] === 'only') { errors.push(`only: ${file}:${i + 1}`); continue; }
        const marker = lines[i - 1]?.match(/^\s*\/\/ ci-quarantine: ([\w-]+)\s*$/)?.[1];
        const entry = quarantine.entries.find((item) => item.id === marker);
        const owners = stages.filter((stage) => (stage.tests ?? []).some((pattern) => new RegExp(pattern).test(file)));
        if (!entry || !entry.test.startsWith(`${file} > `) || !owners.some((stage) => stage.id === entry.stage)) errors.push(`quarantine-marker: ${file}:${i + 1}`);
        else { used.add(entry.id); warnings.push(`quarantine: ${entry.id} ${file}`); }
      }
    }
  }
  for (const id of ids) if (!used.has(id)) errors.push(`quarantine-orphan: ${id}`);
  return { errors, warnings };
}
export function retryErrors(configs, scripts) {
  return [...Object.entries(configs).filter(([, source]) => /\bretry\s*:/.test(source)).map(([file]) => `retry: ${file}`),
    ...Object.entries(scripts).filter(([, script]) => /--retry\b/.test(script)).map(([name]) => `retry: npm ${name}`)];
}
export function workflowErrors(workflows) {
  const errors = [];
  for (const [file, source] of Object.entries(workflows)) {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^\s*-?\s*uses:\s*(.*)$/);
      if (!match) continue;
      if (!/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}\s+# v\d[\w.+-]*\s*$/.test(match[1])) errors.push(`action-pin: ${file}:${i + 1}`);
      if (/actions\/upload-artifact@/i.test(match[1])) errors.push(`artifacts: ${file}`);
      if (/^actions\/checkout@/.test(match[1])) {
        const indent = lines[i].match(/^\s*/)[0].length;
        const step = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && lines[j].match(/^\s*/)[0].length <= indent) break;
          step.push(lines[j]);
        }
        if (!step.some((line) => /^\s+persist-credentials:\s*false\s*$/.test(line))) errors.push(`checkout-credentials: ${file}:${i + 1}`);
      }
    }
    if (file === '.github/workflows/ci.yml' && /\bsecrets\s*\./.test(source)) errors.push(`secrets: ${file}`);
    const permissions = source.match(/^permissions:\s*\n((?:[ \t]+[^\n]*\n|\n)*)/m)?.[1];
    if (!permissions || /:\s*write\b|write-all/.test(permissions) || !/^  contents: read\s*$/m.test(permissions)) errors.push(`permissions: ${file}`);
    // No job-level permission escalation either.
    if (/^\s+permissions:[^\n]*(?:write|\{)/m.test(source) || /^\s{6,}\w[\w-]*:\s*write\s*$/m.test(source)) errors.push(`permissions: ${file}`);
  }
  return errors;
}
