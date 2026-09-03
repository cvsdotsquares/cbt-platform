export type GuideRole = 'admin' | 'teacher' | 'candidate';

export type GuideStep = {
  title: string;
  description: string;
  tip?: string;
  href?: string;
  hrefLabel?: string;
};

export type GuideSection = {
  id: string;
  title: string;
  description: string;
  steps: GuideStep[];
};

export type GuideFaq = {
  question: string;
  answer: string;
};

export type RoleGuide = {
  role: GuideRole;
  badge: string;
  title: string;
  highlight: string;
  summary: string;
  workflowTitle: string;
  workflow: string[];
  sections: GuideSection[];
  faqs: GuideFaq[];
};

export const ADMIN_GUIDE: RoleGuide = {
  role: 'admin',
  badge: 'Admin Help',
  title: 'Institute Admin Guide',
  highlight: 'Guide',
  summary:
    'Set up your institute once, then run the daily loop: books → classes → syllabus → AI tests → students → results.',
  workflowTitle: 'Recommended setup order',
  workflow: [
    'Upload NCERT books for your classes',
    'Create academic classes and batches',
    'Build syllabus from chapters and topics',
    'Generate and publish class tests',
    'Add students and assign them to batches',
    'Review results and publish scores',
    'Invite teachers and configure settings',
  ],
  sections: [
    {
      id: 'books',
      title: 'NCERT Books',
      description: 'Source material that powers syllabus mapping and AI-generated class tests.',
      steps: [
        {
          title: 'Upload books',
          description: 'Go to NCERT Books and upload PDFs tagged by class and subject.',
          href: '/dashboard/materials',
          hrefLabel: 'Open NCERT Books',
        },
        {
          title: 'Keep files organised',
          description: 'Use clear names (subject + class) so teachers can find the right book when planning tests.',
          tip: 'Upload core textbooks first — they unlock stronger AI test generation.',
        },
      ],
    },
    {
      id: 'classes',
      title: 'Classes & Batches',
      description: 'Structure who learns what — academic classes hold batches of students.',
      steps: [
        {
          title: 'Create classes',
          description: 'Add Classes 9–12 (or your institute’s structure) under Classes & Batches.',
          href: '/dashboard/batches',
          hrefLabel: 'Open Classes & Batches',
        },
        {
          title: 'Create batches',
          description: 'Split each class into batches (e.g. A / B) and assign teachers where needed.',
        },
      ],
    },
    {
      id: 'syllabus',
      title: 'Syllabus',
      description: 'Map chapters and topics so progress tracking and tests stay aligned to NCERT.',
      steps: [
        {
          title: 'Define chapters & topics',
          description: 'Open Syllabus, pick a subject, and confirm chapter/topic coverage for the term.',
          href: '/dashboard/syllabus',
          hrefLabel: 'Open Syllabus',
        },
        {
          title: 'Track teaching progress',
          description: 'Teachers update topic status; you can oversee coverage from the same areas.',
        },
      ],
    },
    {
      id: 'tests',
      title: 'Class Tests',
      description: 'Create NCERT-aligned tests with AI, then manage the live exam lifecycle.',
      steps: [
        {
          title: 'Generate a test',
          description: 'Use Create Class Test to pick class, subject, chapters, and difficulty — then generate questions.',
          href: '/dashboard/ai-tests',
          hrefLabel: 'Create Class Test',
        },
        {
          title: 'Review & schedule',
          description: 'Edit questions if needed, set duration and window, then publish from Class Tests.',
          href: '/dashboard/exams',
          hrefLabel: 'Open Class Tests',
          tip: 'Publish only when the start window and student list are ready.',
        },
      ],
    },
    {
      id: 'students',
      title: 'Students & Results',
      description: 'Enrol learners, verify KYC when required, and release results.',
      steps: [
        {
          title: 'Add students',
          description: 'Register students, assign batches, and monitor KYC status from Students.',
          href: '/dashboard/candidates',
          hrefLabel: 'Open Students',
        },
        {
          title: 'Publish results',
          description: 'After submission, review scores under Results and publish so students can see them.',
          href: '/dashboard/results',
          hrefLabel: 'Open Results',
        },
      ],
    },
    {
      id: 'staff',
      title: 'Staff & Settings',
      description: 'Invite teachers and keep institute preferences up to date.',
      steps: [
        {
          title: 'Invite staff',
          description: 'Add teachers and other staff under Staff & Teachers so they get the right portal access.',
          href: '/dashboard/users',
          hrefLabel: 'Staff & Teachers',
        },
        {
          title: 'Institute settings',
          description: 'Update institute profile and preferences from Institute Settings.',
          href: '/dashboard/settings',
          hrefLabel: 'Institute Settings',
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'What should I set up first on a new institute?',
      answer:
        'Books → classes/batches → syllabus → at least one teacher → then your first class test. Students can be added in parallel once batches exist.',
    },
    {
      question: 'Why can’t a teacher see Users or Settings?',
      answer:
        'Teachers use a simplified portal focused on classes, syllabus, tests, and results. Staff management and institute settings stay with admins.',
    },
    {
      question: 'When do students see a test?',
      answer:
        'After you publish it and they are registered for that exam (usually via their batch). They see it under the Student Portal during the scheduled window.',
    },
  ],
};

export const TEACHER_GUIDE: RoleGuide = {
  role: 'teacher',
  badge: 'Teacher Help',
  title: 'Teacher Portal Guide',
  highlight: 'Guide',
  summary:
    'Teach from your assigned subjects: track topic progress, create class tests with AI, and follow student performance.',
  workflowTitle: 'Your day-to-day flow',
  workflow: [
    'Open Home for an overview of students, tests, and submissions',
    'Check Syllabus and mark topic progress',
    'Create a class test from covered chapters',
    'Publish and monitor Class Tests',
    'Review My Students and Results',
  ],
  sections: [
    {
      id: 'classes',
      title: 'Home dashboard',
      description: 'Your starting point — alerts, counts, and shortcuts for teaching.',
      steps: [
        {
          title: 'Start on Home',
          description: 'See upcoming tests, recent submissions, and quick actions from Home.',
          href: '/dashboard/teacher',
          hrefLabel: 'Open Home',
        },
        {
          title: 'Use Syllabus for books',
          description: 'NCERT books and chapter lists live under Syllabus for each subject you teach.',
          href: '/dashboard/syllabus',
          hrefLabel: 'Open Syllabus',
        },
      ],
    },
    {
      id: 'progress',
      title: 'Topic Progress',
      description: 'Keep curriculum coverage current so tests match what you have taught.',
      steps: [
        {
          title: 'Update topic status',
          description: 'From Topic Progress, mark chapters/topics as taught or in progress for your batches.',
          href: '/dashboard/batches',
          hrefLabel: 'Open Topic Progress',
          tip: 'Update progress before generating AI tests so questions stay aligned to taught content.',
        },
      ],
    },
    {
      id: 'tests',
      title: 'Create & manage tests',
      description: 'Generate NCERT-aligned papers and run them for your classes.',
      steps: [
        {
          title: 'Generate with AI',
          description: 'Choose class, subject, and topics, then generate questions under Create Class Test.',
          href: '/dashboard/ai-tests',
          hrefLabel: 'Create Class Test',
        },
        {
          title: 'Schedule & publish',
          description: 'Set duration and time window, review questions, then publish from Class Tests.',
          href: '/dashboard/exams',
          hrefLabel: 'Open Class Tests',
        },
      ],
    },
    {
      id: 'students',
      title: 'Students & Results',
      description: 'Know who is in your classes and how they scored.',
      steps: [
        {
          title: 'My Students',
          description: 'View learners in your batches and check readiness (e.g. KYC) before high-stakes tests.',
          href: '/dashboard/candidates',
          hrefLabel: 'My Students',
        },
        {
          title: 'Results',
          description: 'Review scores after submissions. Admins may handle final publish depending on institute policy.',
          href: '/dashboard/results',
          hrefLabel: 'Open Results',
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'I don’t see Staff & Teachers or Settings — is that normal?',
      answer:
        'Yes. The teacher portal is intentionally simpler. Ask your institute admin for account or institute changes.',
    },
    {
      question: 'Can I create a test for any class?',
      answer:
        'You can create tests for subjects and batches assigned to you. If something is missing, ask your admin to assign the class.',
    },
    {
      question: 'What if AI-generated questions look off?',
      answer:
        'Edit or remove questions before publishing. Prefer generating from syllabus topics you have already marked as covered.',
    },
  ],
};

export const CANDIDATE_GUIDE: RoleGuide = {
  role: 'candidate',
  badge: 'Student Help',
  title: 'Student Portal Guide',
  highlight: 'Guide',
  summary:
    'Take NCERT class tests, download admit cards, track chapter-wise progress, and collect certificates when results are published.',
  workflowTitle: 'How exams work for you',
  workflow: [
    'Log in to the Student Portal',
    'Complete KYC if your institute asks for it',
    'Find your class test and open the admit card',
    'Start the test in the scheduled window',
    'Check Results after publish — download a certificate when available',
    'Use Syllabus Progress to see weak and strong topics',
  ],
  sections: [
    {
      id: 'portal',
      title: 'Student Portal basics',
      description: 'Everything you need is on one page: Class Tests, Results, and Syllabus Progress.',
      steps: [
        {
          title: 'Class Tests tab',
          description: 'See upcoming, live, and past tests with status badges and countdown for tests that have not opened yet.',
          href: '/my-exams',
          hrefLabel: 'Back to portal',
        },
        {
          title: 'Results & Progress',
          description: 'After publish, open Results for scores. Syllabus Progress shows chapter/topic mastery and weak areas.',
        },
      ],
    },
    {
      id: 'kyc',
      title: 'KYC verification',
      description: 'Some institutes require identity verification before you can sit for tests.',
      steps: [
        {
          title: 'Submit documents',
          description: 'If KYC shows Not Submitted or Rejected, complete the KYC card on your portal and wait for verification.',
          tip: 'Upload clear photos of the documents your institute requested. Retries are allowed after rejection.',
        },
      ],
    },
    {
      id: 'exam-day',
      title: 'On exam day',
      description: 'Arrive prepared so you can start as soon as the window opens.',
      steps: [
        {
          title: 'Admit card',
          description: 'Open Admit Card for the test to confirm details. Keep your registration number handy.',
        },
        {
          title: 'Start the test',
          description: 'When status shows Available, use Start / Resume. Read instructions carefully before the timer begins.',
          tip: 'Use a stable connection, a modern browser, and a quiet place. Don’t refresh aggressively mid-exam.',
        },
        {
          title: 'Submit before time ends',
          description: 'Answer as many questions as you can, then submit. Unsaved answers may be lost if the window closes.',
        },
      ],
    },
    {
      id: 'after',
      title: 'After the test',
      description: 'Scores and certificates appear once your institute publishes results.',
      steps: [
        {
          title: 'View results',
          description: 'Check the Results tab for percentage, rank (if shown), and pass/fail against the cut-off.',
        },
        {
          title: 'Download certificate',
          description: 'When available, open the certificate dialog to download or print your certificate.',
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'I can’t see any class tests.',
      answer:
        'You may not be assigned to a batch yet, or no test has been published for your class. Contact your teacher or institute admin.',
    },
    {
      question: 'The Start button is disabled.',
      answer:
        'The test window may not have opened, KYC may be incomplete, or you already submitted. Check the status badge and countdown.',
    },
    {
      question: 'Where is my certificate?',
      answer:
        'Certificates appear only after results are published. Open Results and use the certificate action on a published score.',
    },
  ],
};

export function getGuideForRole(role: GuideRole): RoleGuide {
  if (role === 'teacher') return TEACHER_GUIDE;
  if (role === 'candidate') return CANDIDATE_GUIDE;
  return ADMIN_GUIDE;
}
