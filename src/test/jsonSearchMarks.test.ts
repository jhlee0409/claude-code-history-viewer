import { expect, it } from 'vitest';
import { jsonSearchRanges } from '@/components/common/jsonSearchMarks';
import { searchRanges } from '@/components/common/searchMarks';
const samples=['C:\\work\\report.txt','say "hello"','one\ntwo','one\ttwo','İ prefix 😀 끝','\\"},"fake":"value','\b\f\r\u0000', '\ud800', '\udc00','abababa','東京 경로'];
for(const value of samples)it(`serialized exact-span invariant ${JSON.stringify(value)}`,()=>{
 const text=JSON.stringify({[value]:'ordinary',nested:[value,value]},null,2);
 const ranges=jsonSearchRanges(text,value);
 expect(ranges.map(([s,e])=>text.slice(s,e))).toEqual([JSON.stringify(value).slice(1,-1),JSON.stringify(value).slice(1,-1)]);
 let end=0;for(const [s,e] of ranges){expect(s).toBeGreaterThanOrEqual(end);expect(e).toBeGreaterThan(s);end=e;}
 expect(JSON.parse(text)).toEqual({[value]:'ordinary',nested:[value,value]});
});
it('literal and unicode-escaped spellings map to the same decoded occurrences',()=>{
 const raw=String.raw`{"key":"\u0061\u0062a ABA aba","ABA":"other"}`;
 expect(jsonSearchRanges(raw,'aBa').map(([s,e])=>raw.slice(s,e))).toEqual([String.raw`\u0061\u0062a`,'ABA','aba']);
 expect(searchRanges('İ 😀 aba','aba')).toEqual([[5,8]]);
});
it('no cross-field/punctuation/key/blank/malformed hits; deeply nested arrays are safe',()=>{
 for(const q of ['key','tail\nhead','tail head','", "',' ',''])expect(jsonSearchRanges('{"key":["tail","head"]}',q)).toEqual([]);
 for(const raw of ['{"key":"needle','["needle",]','{"key":NaN}','not JSON'])expect(jsonSearchRanges(raw,'needle')).toEqual([]);
 const deep='['.repeat(2000)+'"needle"'+']'.repeat(2000);expect(jsonSearchRanges(deep,'needle')).toEqual([[2001,2007]]);
});
it('numbers booleans null keep plain substring behavior without keys',()=>{
 const raw='{"false":120,"n":false,"v":null}';
 for(const q of ['20','false','null'])expect(jsonSearchRanges(raw,q).map(([s,e])=>raw.slice(s,e))).toEqual([q]);
});
