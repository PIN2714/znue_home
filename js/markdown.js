/* markdown.js
   迷你 markdown 解析器
   支援:**bold**, *italic*, `code`, > quote, - list, 1. list, [link](url)
   block-level 處理由 md(),inline 由 inlineMd()
   依賴:helpers.js 的 escapeHtml */

function md(src){
  if (!src) return '';
  const lines = src.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length){
    const line = lines[i];
    // blockquote
    if (/^>\s/.test(line)){
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])){
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inlineMd(buf.join(' ')) + '</blockquote>');
      continue;
    }
    // unordered list
    if (/^[-*]\s/.test(line)){
      const buf = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])){
        buf.push('<li>' + inlineMd(lines[i].replace(/^[-*]\s/, '')) + '</li>');
        i++;
      }
      out.push('<ul>' + buf.join('') + '</ul>');
      continue;
    }
    // ordered list
    if (/^\d+\.\s/.test(line)){
      const buf = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])){
        buf.push('<li>' + inlineMd(lines[i].replace(/^\d+\.\s/, '')) + '</li>');
        i++;
      }
      out.push('<ol>' + buf.join('') + '</ol>');
      continue;
    }
    // empty line breaks paragraph
    if (line.trim() === ''){ i++; continue; }
    // paragraph (collect consecutive non-block lines)
    const pbuf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^[-*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !/^>\s/.test(lines[i])){
      pbuf.push(lines[i]);
      i++;
    }
    out.push('<p>' + inlineMd(pbuf.join('<br>')) + '</p>');
  }
  return out.join('');
}

function inlineMd(s){
  s = escapeHtml(s);
  // restore <br> we added
  s = s.replace(/&lt;br&gt;/g, '<br>');
  // code: `text`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic: *text*
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // link: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
