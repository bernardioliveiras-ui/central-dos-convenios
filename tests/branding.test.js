import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const projectRoot = new URL('../', import.meta.url);

for (const page of ['index.html', 'portal.html']) {
  test(`${page} declares the Central dos Convênios favicon`, async () => {
    const html = await readFile(new URL(page, projectRoot), 'utf8');
    assert.match(html, /<link\s+rel="icon"\s+type="image\/png"\s+href="\/favicon\.png"\s*\/?>/);
  });
}

for (const filename of ['favicon.png', 'logo-central-convenios.png']) {
  test(`${filename} uses PNG alpha for transparent background`, async () => {
    const bytes = await readFile(new URL(`public/${filename}`, projectRoot));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes[25], 6, 'Expected RGBA PNG (PNG color type 6)');
  });
}
