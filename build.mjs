import { mkdir, readFile, writeFile } from 'node:fs/promises';
const read = path => readFile(new URL(path,import.meta.url),'utf8');
const hosting = read('.openai/hosting.json').catch(error => {
  if (error.code === 'ENOENT') return '{}';
  throw error;
});
const [html, client, api, manifest] = await Promise.all([
  ...['worker/page.html','worker/client.js','worker/api.js'].map(read),
  hosting
]);
const page = html.replace('/*CLIENT*/',()=>client);
await writeFile(new URL('index.html',import.meta.url),page);
for (const dir of ['dist/server','dist/.openai']) await mkdir(new URL(dir,import.meta.url),{recursive:true});
await writeFile(new URL('dist/server/index.js',import.meta.url),'const page = '+JSON.stringify(page)+';\n'+api);
await writeFile(new URL('dist/.openai/hosting.json',import.meta.url),manifest);
