import type { ADFDocument, ADFNode } from './types.js';

export function parseInlineContent(text: string): ADFNode[] {
  if (!text) return [];

  const parts: ADFNode[] = [];
  const regex = /\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|\[([^\]]+)\|([^\]]+)\]|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.substring(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      parts.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }] });
    } else if (match[2] !== undefined) {
      parts.push({ type: 'text', text: match[2], marks: [{ type: 'strike' }] });
    } else if (match[3] !== undefined) {
      parts.push({ type: 'text', text: match[3], marks: [{ type: 'em' }] });
    } else if (match[4] !== undefined) {
      parts.push({ type: 'text', text: match[4], marks: [{ type: 'link', attrs: { href: match[5] } }] });
    } else if (match[6] !== undefined) {
      parts.push({ type: 'text', text: match[6], marks: [{ type: 'link', attrs: { href: match[7] } }] });
    } else if (match[8] !== undefined) {
      parts.push({ type: 'text', text: match[8], marks: [{ type: 'code' }] });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.substring(lastIndex) });
  }

  return parts;
}

export function addListItem(nodes: ADFNode[], content: ADFNode[], listType: 'bulletList' | 'orderedList'): void {
  const listItem: ADFNode = {
    type: 'listItem',
    content: [{ type: 'paragraph', content }]
  };
  const lastNode = nodes[nodes.length - 1];
  if (lastNode && lastNode.type === listType) {
    lastNode.content!.push(listItem);
  } else {
    nodes.push({ type: listType, content: [listItem] });
  }
}

export function createADFDocument(content: unknown): ADFDocument {
  if (!content || typeof content !== 'string') {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [] }]
    };
  }

  const nodes: ADFNode[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    const jiraHeading = line.match(/^h([1-6])\.\s+(.+)/);
    const mdHeading = line.match(/^(#{1,6})\s+(.+)/);

    if (jiraHeading) {
      nodes.push({
        type: 'heading',
        attrs: { level: parseInt(jiraHeading[1]) },
        content: parseInlineContent(jiraHeading[2])
      });
    } else if (mdHeading) {
      nodes.push({
        type: 'heading',
        attrs: { level: mdHeading[1].length },
        content: parseInlineContent(mdHeading[2])
      });
    } else if (/^!\[[^\]]*\]\([^)]+\)$/.test(line)) {
      const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)!;
      const alt = img[1];
      const target = img[2].trim();
      const media: ADFNode = target.startsWith('media:')
        ? { type: 'media', attrs: { type: 'file', id: target.slice(6), collection: '' } }
        : { type: 'media', attrs: { type: 'external', url: target } };
      if (alt) media.attrs!.alt = alt;
      nodes.push({ type: 'mediaSingle', attrs: { layout: 'center' }, content: [media] });
    } else if (line.startsWith('* ') || line.startsWith('- ')) {
      addListItem(nodes, parseInlineContent(line.substring(2)), 'bulletList');
    } else if (/^\d+\.\s+/.test(line)) {
      addListItem(nodes, parseInlineContent(line.replace(/^\d+\.\s+/, '')), 'orderedList');
    } else if (line.startsWith('> ')) {
      const text = line.substring(2);
      const lastNode = nodes[nodes.length - 1];
      if (lastNode && lastNode.type === 'blockquote') {
        lastNode.content!.push({
          type: 'paragraph',
          content: parseInlineContent(text)
        });
      } else {
        nodes.push({
          type: 'blockquote',
          content: [{ type: 'paragraph', content: parseInlineContent(text) }]
        });
      }
    } else if (line.startsWith('|') && line.endsWith('|')) {
      const parseTableRow = (row: string, cellType: string): ADFNode => ({
        type: 'tableRow',
        content: row.slice(1, -1).split('|').map(cell => ({
          type: cellType,
          content: [{ type: 'paragraph', content: parseInlineContent(cell.trim()) }],
        })),
      });

      const isHeader = i + 1 < lines.length && /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|$/.test(lines[i + 1].trim());
      const tableRows: ADFNode[] = [];

      if (isHeader) {
        tableRows.push(parseTableRow(line, 'tableHeader'));
        i += 2;
      }

      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableRows.push(parseTableRow(lines[i].trim(), 'tableCell'));
        i++;
      }

      if (!isHeader && tableRows.length === 0) {
        tableRows.push(parseTableRow(line, 'tableCell'));
      }

      i--;
      nodes.push({ type: 'table', attrs: { layout: 'default' }, content: tableRows });
    } else if (line === '----' || line === '---') {
      nodes.push({ type: 'rule' });
    } else if (line === '```' || line.startsWith('```')) {
      const lang = line.length > 3 ? line.substring(3).trim() : null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      const codeText = codeLines.join('\n');
      const codeBlock: ADFNode = { type: 'codeBlock' };
      if (codeText) {
        codeBlock.content = [{ type: 'text', text: codeText }];
      }
      if (lang) {
        codeBlock.attrs = { language: lang };
      }
      nodes.push(codeBlock);
    } else {
      nodes.push({
        type: 'paragraph',
        content: parseInlineContent(line)
      });
    }
  }

  if (nodes.length === 0) {
    nodes.push({ type: 'paragraph', content: [] });
  }

  return {
    type: 'doc',
    version: 1,
    content: nodes
  };
}

export function inlineNodesToText(nodes: ADFNode[] | undefined): string {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(node => {
    if (node.type === 'text') {
      let text = node.text || '';
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'strong': text = `**${text}**`; break;
            case 'em': text = `*${text}*`; break;
            case 'strike': text = `~~${text}~~`; break;
            case 'code': text = `\`${text}\``; break;
            case 'link': text = `[${text}](${(mark.attrs?.href as string) || ''})`; break;
          }
        }
      }
      return text;
    }
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return `@${(node.attrs?.text as string) || (node.attrs?.id as string) || ''}`;
    if (node.type === 'inlineCard') return (node.attrs?.url as string) || '';
    if (node.type === 'emoji') return (node.attrs?.shortName as string) || '';
    return '';
  }).join('');
}

export function mediaNodeToText(node: ADFNode): string {
  if (node.type !== 'media') return '';
  const alt = (node.attrs?.alt as string) || '';
  const id = (node.attrs?.id as string) || '';
  const label = alt || id;
  return label ? `[image: ${label}]` : '[image]';
}

export function collectMediaIds(doc: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: ADFNode): void => {
    if (node.type === 'media' && typeof node.attrs?.id === 'string') {
      ids.push(node.attrs.id);
    }
    (node.content || []).forEach(walk);
  };
  if (doc && typeof doc === 'object' && Array.isArray((doc as ADFDocument).content)) {
    (doc as ADFDocument).content.forEach(walk);
  }
  return ids;
}

export function blockNodeToText(node: ADFNode): string {
  if (!node) return '';
  switch (node.type) {
    case 'paragraph':
      return inlineNodesToText(node.content);
    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      return '#'.repeat(level) + ' ' + inlineNodesToText(node.content);
    }
    case 'bulletList':
      return (node.content || []).map(item =>
        '- ' + (item.content || []).map(c => blockNodeToText(c)).join('\n')
      ).join('\n');
    case 'orderedList':
      return (node.content || []).map((item, i) =>
        `${i + 1}. ` + (item.content || []).map(c => blockNodeToText(c)).join('\n')
      ).join('\n');
    case 'blockquote':
      return (node.content || []).map(c => '> ' + blockNodeToText(c)).join('\n');
    case 'codeBlock': {
      const lang = (node.attrs?.language as string) || '';
      const code = inlineNodesToText(node.content);
      return '```' + lang + '\n' + code + '\n```';
    }
    case 'rule':
      return '---';
    case 'table':
      return (node.content || []).map(row =>
        '| ' + (row.content || []).map(cell =>
          (cell.content || []).map(c => blockNodeToText(c)).join(' ')
        ).join(' | ') + ' |'
      ).join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
      return (node.content || []).map(mediaNodeToText).join(' ');
    default:
      return inlineNodesToText(node.content);
  }
}

export function adfToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object' || (doc as ADFDocument).type !== 'doc' || !Array.isArray((doc as ADFDocument).content)) {
    return typeof doc === 'string' ? doc : '';
  }
  return (doc as ADFDocument).content.map(node => blockNodeToText(node)).join('\n\n');
}
