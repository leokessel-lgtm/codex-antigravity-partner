import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd());

function walkDir(dir, callback) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file === '.git') continue;
        const filepath = path.join(dir, file);
        const stat = fs.statSync(filepath);
        if (stat.isDirectory()) {
            walkDir(filepath, callback);
        } else if (file.endsWith('.md')) {
            callback(filepath);
        }
    }
}

let hasErrors = false;
// Regex to extract markdown links. Matches [text](link)
const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;

walkDir(repoRoot, (filepath) => {
    const content = fs.readFileSync(filepath, 'utf8');
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
        let link = match[1].trim();

        // Ignore web URLs and mail links
        if (/^(https?|mailto):/i.test(link)) continue;

        // Ignore same-document anchors
        if (link.startsWith('#')) continue;

        // Strip query and fragment suffixes
        link = link.split('?')[0].split('#')[0];

        if (!link) continue;

        // Decode URL-encoded paths
        link = decodeURIComponent(link);

        let targetPath;
        if (link.startsWith('/')) {
            // Treat absolute path as starting from the repository root
            targetPath = path.join(repoRoot, link);
        } else {
            // Resolve relative to the current file
            targetPath = path.resolve(path.dirname(filepath), link);
        }

        // Reject if it escapes the repository root
        if (!targetPath.startsWith(repoRoot)) {
            console.error(`Error in ${path.relative(repoRoot, filepath)}: Link escapes repository root: ${match[1]}`);
            hasErrors = true;
            continue;
        }

        // Report missing local targets
        if (!fs.existsSync(targetPath)) {
            console.error(`Error in ${path.relative(repoRoot, filepath)}: Missing local target: ${link} (resolved to ${path.relative(repoRoot, targetPath)})`);
            hasErrors = true;
        }
    }
});

if (hasErrors) {
    process.exit(1);
} else {
    console.log('All relative links are valid.');
}
