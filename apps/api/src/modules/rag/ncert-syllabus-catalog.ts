import type { ExtractedChapter } from './syllabus-extraction.service';

/** Official NCERT chapter titles by class level and subject code — used when PDF text is unreadable. */
export const NCERT_SYLLABUS_CATALOG: Record<number, Record<string, string[]>> = {
  9: {
    MATH: ['Number Systems', 'Polynomials', 'Coordinate Geometry', 'Linear Equations', 'Euclid\'s Geometry', 'Lines and Angles', 'Triangles', 'Quadrilaterals', 'Circles', 'Heron\'s Formula', 'Surface Areas and Volumes', 'Statistics'],
    SCI: ['Matter in Our Surroundings', 'Is Matter Around Us Pure', 'Atoms and Molecules', 'Structure of the Atom', 'The Fundamental Unit of Life', 'Tissues', 'Motion', 'Force and Laws of Motion', 'Gravitation', 'Work and Energy', 'Sound', 'Improvement in Food Resources'],
    SST: ['The French Revolution', 'Socialism in Europe', 'Nazism and the Rise of Hitler', 'Forest Society and Colonialism', 'Pastoralists in the Modern World', 'India - Size and Location', 'Physical Features of India', 'Drainage', 'Climate', 'Natural Vegetation and Wildlife', 'Population', 'What is Democracy', 'Constitutional Design', 'Electoral Politics', 'Working of Institutions', 'Democratic Rights'],
    ENG: ['The Fun They Had', 'The Sound of Music', 'The Little Girl', 'A Truly Beautiful Mind', 'The Snake and the Mirror', 'My Childhood', 'Reach for the Top', 'Kathmandu', 'If I Were You'],
  },
  10: {
    MATH: ['Real Numbers', 'Polynomials', 'Pair of Linear Equations in Two Variables', 'Quadratic Equations', 'Arithmetic Progressions', 'Triangles', 'Coordinate Geometry', 'Introduction to Trigonometry', 'Applications of Trigonometry', 'Circles', 'Constructions', 'Areas Related to Circles', 'Surface Areas and Volumes', 'Statistics', 'Probability'],
    SCI: [
      'Chemical Reactions and Equations',
      'Acids, Bases and Salts',
      'Metals and Non-metals',
      'Carbon and its Compounds',
      'Periodic Classification of Elements',
      'Life Processes',
      'Control and Coordination',
      'How do Organisms Reproduce',
      'Heredity and Evolution',
      'Light – Reflection and Refraction',
      'Human Eye and Colourful World',
      'Electricity',
      'Magnetic Effects of Electric Current',
      'Sources of Energy',
      'Our Environment',
      'Sustainable Management of Natural Resources',
    ],
    SST: ['The Rise of Nationalism in Europe', 'Nationalism in India', 'The Making of a Global World', 'The Age of Industrialisation', 'Resources and Development', 'Forest and Wildlife Resources', 'Water Resources', 'Agriculture', 'Minerals and Energy Resources', 'Manufacturing Industries', 'Lifelines of National Economy', 'Power Sharing', 'Federalism', 'Democracy and Diversity', 'Gender Religion and Caste', 'Political Parties', 'Outcomes of Democracy'],
    ENG: ['A Letter to God', 'Nelson Mandela', 'Two Stories about Flying', 'From the Diary of Anne Frank', 'Glimpses of India', 'Mijbil the Otter', 'Madam Rides the Bus', 'The Sermon at Benares', 'The Proposal'],
  },
};

export function getNcertFallbackChapters(classLevel: number, subjectCode: string): ExtractedChapter[] {
  const code = subjectCode.toUpperCase();
  const titles = NCERT_SYLLABUS_CATALOG[classLevel]?.[code];
  if (!titles?.length) return [];

  return titles.map((title, i) => ({
    number: i + 1,
    title,
    content: '',
    topics: [],
  }));
}

export function hasNcertFallback(classLevel?: number, subjectCode?: string): boolean {
  if (!classLevel || !subjectCode) return false;
  return (NCERT_SYLLABUS_CATALOG[classLevel]?.[subjectCode.toUpperCase()]?.length ?? 0) > 0;
}
