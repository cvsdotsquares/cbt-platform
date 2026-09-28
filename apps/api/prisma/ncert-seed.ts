import { PrismaClient } from '@prisma/client';

const NCERT_DATA: Record<number, { subjects: { name: string; code: string; chapters: string[] }[] }> = {
  9: {
    subjects: [
      { name: 'Mathematics', code: 'MATH', chapters: ['Number Systems', 'Polynomials', 'Coordinate Geometry', 'Linear Equations', 'Euclid\'s Geometry', 'Lines and Angles', 'Triangles', 'Quadrilaterals', 'Circles', 'Heron\'s Formula', 'Surface Areas and Volumes', 'Statistics'] },
      { name: 'Science', code: 'SCI', chapters: ['Matter in Our Surroundings', 'Is Matter Around Us Pure', 'Atoms and Molecules', 'Structure of the Atom', 'The Fundamental Unit of Life', 'Tissues', 'Motion', 'Force and Laws of Motion', 'Gravitation', 'Work and Energy', 'Sound', 'Improvement in Food Resources'] },
      { name: 'Social Science', code: 'SST', chapters: ['The French Revolution', 'Socialism in Europe', 'Nazism and the Rise of Hitler', 'Forest Society and Colonialism', 'Pastoralists in the Modern World', 'India - Size and Location', 'Physical Features of India', 'Drainage', 'Climate', 'Natural Vegetation and Wildlife', 'Population', 'What is Democracy', 'Constitutional Design', 'Electoral Politics', 'Working of Institutions', 'Democratic Rights'] },
      { name: 'English', code: 'ENG', chapters: ['The Fun They Had', 'The Sound of Music', 'The Little Girl', 'A Truly Beautiful Mind', 'The Snake and the Mirror', 'My Childhood', 'Reach for the Top', 'Kathmandu', 'If I Were You'] },
    ],
  },
  10: {
    subjects: [
      { name: 'Mathematics', code: 'MATH', chapters: ['Real Numbers', 'Polynomials', 'Pair of Linear Equations', 'Quadratic Equations', 'Arithmetic Progressions', 'Triangles', 'Coordinate Geometry', 'Introduction to Trigonometry', 'Applications of Trigonometry', 'Circles', 'Constructions', 'Areas Related to Circles', 'Surface Areas and Volumes', 'Statistics', 'Probability'] },
      { name: 'Science', code: 'SCI', chapters: ['Chemical Reactions and Equations', 'Acids, Bases and Salts', 'Metals and Non-metals', 'Carbon and its Compounds', 'Periodic Classification of Elements', 'Life Processes', 'Control and Coordination', 'How do Organisms Reproduce', 'Heredity and Evolution', 'Light – Reflection and Refraction', 'Human Eye and Colourful World', 'Electricity', 'Magnetic Effects of Electric Current', 'Sources of Energy', 'Our Environment', 'Sustainable Management of Natural Resources'] },
      { name: 'Social Science', code: 'SST', chapters: ['The Rise of Nationalism in Europe', 'Nationalism in India', 'The Making of a Global World', 'The Age of Industrialisation', 'Resources and Development', 'Forest and Wildlife Resources', 'Water Resources', 'Agriculture', 'Minerals and Energy Resources', 'Manufacturing Industries', 'Lifelines of National Economy', 'Power Sharing', 'Federalism', 'Democracy and Diversity', 'Gender Religion and Caste', 'Political Parties', 'Outcomes of Democracy'] },
      { name: 'English', code: 'ENG', chapters: ['A Letter to God', 'Nelson Mandela', 'Two Stories about Flying', 'From the Diary of Anne Frank', 'Glimpses of India', 'Mijbil the Otter', 'Madam Rides the Bus', 'The Sermon at Benares', 'The Proposal'] },
    ],
  },
  11: {
    subjects: [
      { name: 'Physics', code: 'PHY', chapters: ['Physical World', 'Units and Measurements', 'Motion in a Straight Line', 'Motion in a Plane', 'Laws of Motion', 'Work Energy and Power', 'System of Particles', 'Gravitation', 'Mechanical Properties of Solids', 'Mechanical Properties of Fluids', 'Thermal Properties of Matter', 'Thermodynamics', 'Kinetic Theory', 'Oscillations', 'Waves'] },
      { name: 'Chemistry', code: 'CHEM', chapters: ['Some Basic Concepts of Chemistry', 'Structure of Atom', 'Classification of Elements', 'Chemical Bonding', 'States of Matter', 'Thermodynamics', 'Equilibrium', 'Redox Reactions', 'Hydrogen', 's-Block Elements', 'p-Block Elements', 'Organic Chemistry Basics', 'Hydrocarbons', 'Environmental Chemistry'] },
      { name: 'Mathematics', code: 'MATH', chapters: ['Sets', 'Relations and Functions', 'Trigonometric Functions', 'Principle of Mathematical Induction', 'Complex Numbers', 'Linear Inequalities', 'Permutations and Combinations', 'Binomial Theorem', 'Sequences and Series', 'Straight Lines', 'Conic Sections', 'Introduction to Three Dimensional Geometry', 'Limits and Derivatives', 'Mathematical Reasoning', 'Statistics', 'Probability'] },
      { name: 'Biology', code: 'BIO', chapters: ['The Living World', 'Biological Classification', 'Plant Kingdom', 'Animal Kingdom', 'Morphology of Flowering Plants', 'Anatomy of Flowering Plants', 'Structural Organisation in Animals', 'Cell The Unit of Life', 'Biomolecules', 'Cell Cycle and Cell Division', 'Transport in Plants', 'Mineral Nutrition', 'Photosynthesis in Higher Plants', 'Respiration in Plants', 'Plant Growth and Development', 'Digestion and Absorption', 'Breathing and Exchange of Gases', 'Body Fluids and Circulation', 'Excretory Products and their Elimination', 'Locomotion and Movement', 'Neural Control and Coordination', 'Chemical Coordination and Integration'] },
    ],
  },
  12: {
    subjects: [
      { name: 'Physics', code: 'PHY', chapters: ['Electric Charges and Fields', 'Electrostatic Potential and Capacitance', 'Current Electricity', 'Moving Charges and Magnetism', 'Magnetism and Matter', 'Electromagnetic Induction', 'Alternating Current', 'Electromagnetic Waves', 'Ray Optics and Optical Instruments', 'Wave Optics', 'Dual Nature of Radiation and Matter', 'Atoms', 'Nuclei', 'Semiconductor Electronics'] },
      { name: 'Chemistry', code: 'CHEM', chapters: ['The Solid State', 'Solutions', 'Electrochemistry', 'Chemical Kinetics', 'Surface Chemistry', 'General Principles of Isolation of Elements', 'p-Block Elements', 'd and f Block Elements', 'Coordination Compounds', 'Haloalkanes and Haloarenes', 'Alcohols Phenols and Ethers', 'Aldehydes Ketones and Carboxylic Acids', 'Amines', 'Biomolecules', 'Polymers', 'Chemistry in Everyday Life'] },
      { name: 'Mathematics', code: 'MATH', chapters: ['Relations and Functions', 'Inverse Trigonometric Functions', 'Matrices', 'Determinants', 'Continuity and Differentiability', 'Application of Derivatives', 'Integrals', 'Application of Integrals', 'Differential Equations', 'Vector Algebra', 'Three Dimensional Geometry', 'Linear Programming', 'Probability'] },
      { name: 'Biology', code: 'BIO', chapters: ['Reproduction in Organisms', 'Sexual Reproduction in Flowering Plants', 'Human Reproduction', 'Reproductive Health', 'Principles of Inheritance and Variation', 'Molecular Basis of Inheritance', 'Evolution', 'Human Health and Disease', 'Strategies for Enhancement in Food Production', 'Microbes in Human Welfare', 'Biotechnology Principles and Processes', 'Biotechnology and its Applications', 'Organisms and Populations', 'Ecosystem', 'Biodiversity and Conservation', 'Environmental Issues'] },
    ],
  },
};

export async function seedNcertCurriculum(prisma: PrismaClient, tenantId?: string) {
  console.log('Seeding NCERT curriculum (Classes 9-12)...');

  for (const [levelStr, classData] of Object.entries(NCERT_DATA)) {
    const level = parseInt(levelStr, 10);
    const cls = await prisma.academicClass.findFirst({
      where: { level, tenantId: tenantId ?? null },
    }) ?? await prisma.academicClass.create({
      data: {
        tenantId: tenantId ?? null,
        level,
        name: `Class ${level}`,
        description: `NCERT curriculum for Class ${level}`,
      },
    });

    for (const [si, subject] of classData.subjects.entries()) {
      const sub = await prisma.subject.upsert({
        where: { academicClassId_code: { academicClassId: cls.id, code: subject.code } },
        update: { name: subject.name },
        create: {
          academicClassId: cls.id,
          name: subject.name,
          code: subject.code,
          orderIndex: si,
        },
      });

      const book = await prisma.book.findFirst({
        where: { subjectId: sub.id, title: `NCERT ${subject.name} Class ${level}` },
      }) ?? await prisma.book.create({
        data: {
          subjectId: sub.id,
          title: `NCERT ${subject.name} Class ${level}`,
          publisher: 'NCERT',
          isNcert: true,
          orderIndex: 0,
        },
      });

      for (const [ci, chapterTitle] of subject.chapters.entries()) {
        const chapter = await prisma.chapter.upsert({
          where: { bookId_number: { bookId: book.id, number: ci + 1 } },
          update: { title: chapterTitle },
          create: {
            bookId: book.id,
            number: ci + 1,
            title: chapterTitle,
            orderIndex: ci,
          },
        });

        const existing = await prisma.syllabusTopic.findFirst({ where: { chapterId: chapter.id } });
        if (!existing) {
          await prisma.syllabusTopic.create({
            data: {
              chapterId: chapter.id,
              title: 'Key Concepts',
              description: `Main concepts from ${chapterTitle}`,
              orderIndex: 0,
            },
          });
        }
      }
    }
  }

  console.log('NCERT curriculum seeded.');
}

export async function seedDemoBatch(prisma: PrismaClient, tenantId: string, candidateId: string) {
  const class10 = await prisma.academicClass.findFirst({ where: { level: 10 } });
  if (!class10) return;

  const batch = await prisma.batch.findFirst({
    where: {
      tenantId,
      name: 'Batch A',
      academicYear: '2025-26',
      academicClassId: class10.id,
    },
  }) ?? await prisma.batch.create({
    data: {
      tenantId,
      academicClassId: class10.id,
      name: 'Batch A',
      academicYear: '2025-26',
    },
  });

  await prisma.batchEnrollment.upsert({
    where: { batchId_candidateId: { batchId: batch.id, candidateId } },
    update: {},
    create: { batchId: batch.id, candidateId, rollNumber: '001' },
  });

  const chapters = await prisma.chapter.findMany({
    where: { book: { subject: { academicClassId: class10.id, code: 'SCI' } } },
    take: 3,
  });

  for (const ch of chapters) {
    const existing = await prisma.syllabusProgress.findFirst({
      where: { batchId: batch.id, chapterId: ch.id, topicId: null },
    });
    if (existing) {
      await prisma.syllabusProgress.update({
        where: { id: existing.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } else {
      await prisma.syllabusProgress.create({
        data: { batchId: batch.id, chapterId: ch.id, status: 'COMPLETED', completedAt: new Date() },
      });
    }
  }

  if (chapters[3]) {
    const inProgress = await prisma.syllabusProgress.findFirst({
      where: { batchId: batch.id, chapterId: chapters[3].id, topicId: null },
    });
    if (inProgress) {
      await prisma.syllabusProgress.update({ where: { id: inProgress.id }, data: { status: 'IN_PROGRESS' } });
    } else {
      await prisma.syllabusProgress.create({
        data: { batchId: batch.id, chapterId: chapters[3].id, status: 'IN_PROGRESS' },
      });
    }
  }

  return batch;
}
