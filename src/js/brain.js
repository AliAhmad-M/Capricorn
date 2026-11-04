// Placeholder assistant logic until real tools are connected.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(query) {
  await sleep(1800 + Math.random() * 1200); // fake "analysing" time
  const q = query.toLowerCase();

  if (/\btime\b|\bclock\b/.test(q)) {
    const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return { text: `It's ${now}.` };
  }
  if (/\bfind\b|\bfile\b|\bsearch\b/.test(q)) {
    return { text: 'I found 3 matching files in Documents. (Dummy result: file search is not connected yet.)' };
  }
  if (/\bemail\b|\bmail\b|\bsend\b/.test(q)) {
    return { text: 'Draft ready. I have not sent anything. (Dummy result: email is not connected yet.)' };
  }
  if (/\bremind\b|\breminder\b/.test(q)) {
    return { text: 'Reminder noted. (Dummy result: scheduling is not connected yet.)' };
  }
  return { text: `I heard: "${query}".` };
}

module.exports = { ask };