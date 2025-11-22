import { sanitizeFilename } from './utils/helpers';

const testCases = [
  "Video Title #hashtag",
  "Video #cool #viral Title",
  "Just a Title",
  "Title with # and space", 
  "Title with #tag1 #tag2",
  "Chinese Title #你好",
  "Title with #1",
  "Title with #",
];

console.log("Testing sanitizeFilename:");
testCases.forEach(title => {
  console.log(`Original: "${title}"`);
  console.log(`Sanitized: "${sanitizeFilename(title)}"`);
  console.log("---");
});
