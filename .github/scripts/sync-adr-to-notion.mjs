/**
 * Syncs ADR markdown files from .claude/adr/ to Notion.
 *
 * Requires:
 * - NOTION_TOKEN: Notion integration token
 * - NOTION_ADR_PAGE_ID: Parent page ID for ADRs
 */

import { Client } from '@notionhq/client';
import fs from 'fs/promises';
import path from 'path';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ADR_PAGE_ID = process.env.NOTION_ADR_PAGE_ID;
const ADR_DIR = '.claude/adr';

async function getExistingADRs() {
  const response = await notion.blocks.children.list({
    block_id: ADR_PAGE_ID,
    page_size: 100,
  });

  const adrPages = new Map();
  for (const block of response.results) {
    if (block.type === 'child_page') {
      const title = block.child_page.title;
      const match = title.match(/^ADR-(\d+)/);
      if (match) {
        adrPages.set(match[1], block.id);
      }
    }
  }
  return adrPages;
}

function parseADRMarkdown(content) {
  const lines = content.split('\n');
  let title = '';
  let status = 'proposed';
  let date = '';

  for (const line of lines) {
    if (line.startsWith('# ADR-')) {
      title = line.replace('# ', '').trim();
    }
    if (line.startsWith('## Status')) {
      const nextLineIdx = lines.indexOf(line) + 1;
      if (nextLineIdx < lines.length) {
        status = lines[nextLineIdx].trim().toLowerCase();
      }
    }
    if (line.startsWith('## Date')) {
      const nextLineIdx = lines.indexOf(line) + 1;
      if (nextLineIdx < lines.length) {
        date = lines[nextLineIdx].trim();
      }
    }
  }

  return { title, status, date, content };
}

function markdownToNotionBlocks(markdown) {
  // Simple conversion - for complex markdown, consider using a proper parser
  const blocks = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('# ')) {
      // Skip title, it's in page properties
      i++;
      continue;
    }

    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [{ type: 'text', text: { content: line.replace('## ', '') } }],
        },
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: line.replace('### ', '') } }],
        },
      });
    } else if (line.startsWith('- ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace('- ', '') } }],
        },
      });
    } else if (line.startsWith('1. ') || line.match(/^\d+\. /)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\. /, '') } }],
        },
      });
    } else if (line.trim() !== '') {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line } }],
        },
      });
    }

    i++;
  }

  return blocks;
}

async function createOrUpdateADR(adrNumber, title, blocks, existingPageId) {
  if (existingPageId) {
    // Update existing page - archive old content and add new
    console.log(`Updating ADR-${adrNumber}: ${title}`);

    // Get existing blocks
    const existingBlocks = await notion.blocks.children.list({
      block_id: existingPageId,
      page_size: 100,
    });

    // Delete existing blocks
    for (const block of existingBlocks.results) {
      await notion.blocks.delete({ block_id: block.id });
    }

    // Add new blocks
    await notion.blocks.children.append({
      block_id: existingPageId,
      children: blocks.slice(0, 100), // Notion API limit
    });

    return existingPageId;
  } else {
    // Create new page
    console.log(`Creating ADR-${adrNumber}: ${title}`);

    const response = await notion.pages.create({
      parent: { page_id: ADR_PAGE_ID },
      icon: { emoji: '📋' },
      properties: {
        title: {
          title: [{ text: { content: title } }],
        },
      },
      children: blocks.slice(0, 100),
    });

    return response.id;
  }
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.error('NOTION_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!ADR_PAGE_ID) {
    console.error('NOTION_ADR_PAGE_ID environment variable is required');
    process.exit(1);
  }

  console.log('Fetching existing ADRs from Notion...');
  const existingADRs = await getExistingADRs();
  console.log(`Found ${existingADRs.size} existing ADRs`);

  console.log(`Reading ADR files from ${ADR_DIR}...`);
  const files = await fs.readdir(ADR_DIR);
  const adrFiles = files.filter(f => f.match(/^\d{4}-.*\.md$/) && f !== '0000-template.md');

  console.log(`Found ${adrFiles.length} ADR files to sync`);

  for (const file of adrFiles) {
    const adrNumber = file.match(/^(\d{4})/)[1];
    const content = await fs.readFile(path.join(ADR_DIR, file), 'utf-8');
    const { title } = parseADRMarkdown(content);
    const blocks = markdownToNotionBlocks(content);

    const existingPageId = existingADRs.get(adrNumber);
    await createOrUpdateADR(adrNumber, title || `ADR-${adrNumber}`, blocks, existingPageId);
  }

  console.log('Sync complete!');
}

main().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
