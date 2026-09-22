import fs from 'node:fs';
import path from 'node:path';

import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toString } from 'hast-util-to-string';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { basePath, navigation, repoUrl } from '@/lib/site';

const docsDir = path.join(process.cwd(), '..', 'docs');

export interface Section {
  id: string;
  title: string;
}

export interface DocPage {
  slug: string;
  href: string;
  title: string;
  description: string;
  tree: Root;
  sections: Array<Section>;
}

function preprocess(source: string, file: string) {
  return source
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/<!--@include:\s*(.+?)\s*-->/g, (_, include: string) =>
      fs.readFileSync(path.resolve(path.dirname(file), include), 'utf8')
    )
    .replace(
      /^::: (\w+)(?: (.*))?\n([\s\S]*?)^:::$/gm,
      (_, type: string, title = '', body: string) =>
        `<div class="callout" data-type="${type}" data-title="${title}">\n\n${body}\n</div>`
    );
}

function resolveHref(href: string, pageHref: string) {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return href;
  let url = new URL(href, `https://site${pageHref}`);
  let pathname = url.pathname.replace(/\.md$/, '');
  if (!allSlugs().includes(pathname.slice(1))) {
    return `${repoUrl}/blob/main${pathname}`;
  }
  return pathname + url.hash;
}

function transform(tree: Root, pageHref: string) {
  let slugger = new GithubSlugger();
  let sections: Array<Section> = [];

  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'h2' || node.tagName === 'h3') {
      let title = toString(node);
      let id = slugger.slug(title);
      node.properties.id = id;
      if (node.tagName === 'h2') sections.push({ id, title });
    }
    if (node.tagName === 'a' && typeof node.properties.href === 'string') {
      node.properties.href = resolveHref(node.properties.href, pageHref);
    }
    if (node.tagName === 'img' && typeof node.properties.src === 'string') {
      if (node.properties.src.startsWith('/')) {
        node.properties.src = basePath + node.properties.src;
      }
    }
  });

  return sections;
}

function slugToFile(slug: string) {
  return path.join(docsDir, `${slug}.md`);
}

let cache = new Map<string, DocPage>();

export function getPage(slug: string): DocPage {
  let cached = cache.get(slug);
  if (cached) return cached;

  let file = slugToFile(slug);
  let href = `/${slug}`;
  let source = preprocess(fs.readFileSync(file, 'utf8'), file);
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  let tree = processor.runSync(processor.parse(source)) as Root;
  let sections = transform(tree, href);

  let h1 = tree.children.find(
    (node): node is Element => node.type === 'element' && node.tagName === 'h1'
  );
  let firstParagraph = tree.children.find(
    (node): node is Element => node.type === 'element' && node.tagName === 'p'
  );
  let description = firstParagraph ? toString(firstParagraph).replace(/\s+/g, ' ').trim() : '';

  let page: DocPage = {
    slug,
    href,
    title: h1 ? toString(h1) : slug,
    description: description.length > 180 ? `${description.slice(0, 177).trimEnd()}…` : description,
    tree,
    sections,
  };
  cache.set(slug, page);
  return page;
}

export function allSlugs() {
  return navigation
    .flatMap((group) => group.links)
    .filter((link) => link.href !== '/guide')
    .map((link) => link.href.slice(1));
}

export function allPages() {
  return allSlugs().map(getPage);
}

function isHeading(node: RootContent, tag: 'h1' | 'h2') {
  return node.type === 'element' && node.tagName === tag;
}

export function searchData() {
  return allPages().map((page) => {
    let sections: Array<[string, string | null, Array<string>]> = [[page.title, null, []]];
    for (let node of page.tree.children) {
      if (isHeading(node, 'h1')) continue;
      if (isHeading(node, 'h2')) {
        let element = node as Element;
        sections.push([toString(element), String(element.properties.id), []]);
        continue;
      }
      let text = toString(node as ElementContent).trim();
      if (text) sections[sections.length - 1][2].push(text);
    }
    return { url: page.href, sections };
  });
}

export function faqs() {
  let page = getPage('faq');
  let items: Array<{ question: string; id: string; answer: Root }> = [];
  for (let node of page.tree.children) {
    if (isHeading(node, 'h1')) continue;
    if (isHeading(node, 'h2')) {
      let element = node as Element;
      items.push({
        question: toString(element),
        id: String(element.properties.id),
        answer: { type: 'root', children: [] },
      });
      continue;
    }
    items.at(-1)?.answer.children.push(node);
  }
  return items;
}
