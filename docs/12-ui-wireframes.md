# 12. UI Wireframes

## Design System

- **Typography:** Inter (UI), JetBrains Mono (code)
- **Colors:** CSS variables with dark/light theme support
- **Spacing:** 4px base grid (Tailwind default)
- **Breakpoints:** sm(640), md(768), lg(1024), xl(1280), 2xl(1536)
- **Components:** Shadcn UI (Radix primitives + Tailwind)

## 1. Login Page

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     ┌─────────────────────────────────────────┐             │
│     │          [Tenant Logo]                   │             │
│     │                                          │             │
│     │     Welcome to CBT Platform              │             │
│     │     Sign in to your account              │             │
│     │                                          │             │
│     │     Email                                │             │
│     │     ┌──────────────────────────────┐     │             │
│     │     │ user@example.com               │     │             │
│     │     └──────────────────────────────┘     │             │
│     │                                          │             │
│     │     Password                             │             │
│     │     ┌──────────────────────────────┐     │             │
│     │     │ ••••••••••            [👁]   │     │             │
│     │     └──────────────────────────────┘     │             │
│     │                                          │             │
│     │     [✓] Remember me    Forgot password?  │             │
│     │                                          │             │
│     │     ┌──────────────────────────────┐     │             │
│     │     │         Sign In                 │     │             │
│     │     └──────────────────────────────┘     │             │
│     │                                          │             │
│     │     ─────── or continue with ───────     │             │
│     │                                          │             │
│     │     Don't have an account? Register      │             │
│     └─────────────────────────────────────────┘             │
│                                                             │
│     [🌙 Dark Mode Toggle]              © 2026 CBT Platform  │
└─────────────────────────────────────────────────────────────┘
```

## 2. Admin Dashboard

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Logo] CBT Platform    🔍 Search...          🔔(3)  [Avatar ▾]     │
├────────┬─────────────────────────────────────────────────────────────┤
│        │                                                             │
│ 📊 Dash│  Good morning, Admin                    [+ Create Exam]    │
│ 📝 Exam│                                                             │
│ ❓ Ques│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ 👥 Cand│  │ Active   │ │ Total    │ │ Today's  │ │ Violation│       │
│ 📋 Resu│  │ Exams    │ │ Candidates│ │ Sessions │ │ Alerts   │       │
│ 📈 Anal│  │    12    │ │  45,230  │ │  8,432   │ │    23    │       │
│ 👁 Moni│  │  ↑ 3     │ │  ↑ 1.2K  │ │  Live    │ │  ⚠ 5 crit│       │
│ ⚙ Sett│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│ 📜 Audi│                                                             │
│        │  ┌─────────────────────────────┐ ┌────────────────────┐    │
│        │  │ Exam Activity (7 days)      │ │ Upcoming Exams     │    │
│        │  │                             │ │                    │    │
│        │  │  ▄▄                          │ │ • GATE 2026        │    │
│        │  │  ██ ▄▄    ▄▄                │ │   Jun 10, 09:00    │    │
│        │  │  ██ ██ ▄▄ ██ ▄▄             │ │   12,000 candidates│    │
│        │  │  ██ ██ ██ ██ ██             │ │                    │    │
│        │  │  Mon Tue Wed Thu Fri        │ │ • UPSC Prelims     │    │
│        │  │                             │ │   Jun 15, 10:00    │    │
│        │  └─────────────────────────────┘ │   8,500 candidates │    │
│        │                                  └────────────────────┘    │
│        │  ┌──────────────────────────────────────────────────────┐  │
│        │  │ Recent Activity                                      │  │
│        │  │ • Exam "GATE 2026" published by John     2 min ago  │  │
│        │  │ • 150 candidates registered for UPSC      15 min ago  │  │
│        │  │ • Question bank import completed (500)     1 hr ago  │  │
│        │  └──────────────────────────────────────────────────────┘  │
└────────┴─────────────────────────────────────────────────────────────┘
```

## 3. Exam Interface (Candidate)

```
┌──────────────────────────────────────────────────────────────────────┐
│ GATE 2026 - Section A: General Aptitude    ⏱ 01:23:45  [Submit]  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Question 15 of 65                              Marks: 2  [-0.5]    │
│  ─────────────────────────────────────────────────────────────       │
│                                                                      │
│  If the ratio of ages of A and B is 3:5 and the sum of their        │
│  ages is 48 years, what is the age of A?                            │
│                                                                      │
│  ○  16 years                                                        │
│  ●  18 years                                                        │
│  ○  20 years                                                        │
│  ○  24 years                                                        │
│                                                                      │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  ◀ Previous    [🔖 Mark for Review]    [🗑 Clear]    Next ▶       │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐                        │
│  │1│2│3│4│5│6│7│8│9│10│...│15│...│63│64│65│                        │
│  │✓│✓│✓│✓│✓│✓│✓│✓│✓│✓ │   │●│   │ │ │ │                        │
│  └─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘                        │
│  ✓ Answered  ● Current  🔖 Review  ○ Not Visited                   │
│                                                                      │
│  [📷 Proctoring Active]  Risk: Low (12)  [🟢 Connected]           │
└──────────────────────────────────────────────────────────────────────┘
```

## 4. Live Monitoring Dashboard (Proctor)

```
┌──────────────────────────────────────────────────────────────────────┐
│ LIVE MONITORING: GATE 2026          Active: 8,432  Submitted: 1,205  │
├──────────────────────────────────────────────────────────────────────┤
│ Filters: [All ▾] [Risk: Any ▾] [Status: Active ▾]  🔍 Search...    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ CRITICAL ALERTS (5) ──────────────────────────────────────────┐ │
│  │ ⚠ CAND-4521 Multiple faces detected (Risk: 87)    [Intervene] │ │
│  │ ⚠ CAND-8892 Tab switch x3 (Risk: 72)              [Intervene] │ │
│  │ ⚠ CAND-3301 Face mismatch (Risk: 91)              [Intervene] │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ CAND-001 │ │ CAND-002 │ │ CAND-003 │ │ CAND-004 │ │ CAND-005 │ │
│  │ [video]  │ │ [video]  │ │ [video]  │ │ [video]  │ │ [video]  │ │
│  │ 🟢 Low   │ │ 🟡 Med   │ │ 🟢 Low   │ │ 🔴 High  │ │ 🟢 Low   │ │
│  │ Q: 23/65 │ │ Q: 45/65 │ │ Q: 12/65 │ │ Q: 58/65 │ │ Q: 33/65 │ │
│  │ 1:23:00  │ │ 0:45:00  │ │ 1:45:00  │ │ 0:12:00  │ │ 1:05:00  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ CAND-006 │ │ CAND-007 │ │ CAND-008 │ │ CAND-009 │ │ CAND-010 │ │
│  │ ...      │ │ ...      │ │ ...      │ │ ...      │ │ ...      │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                                      │
│  Page 1 of 844  [◀ Prev] [Next ▶]                                  │
└──────────────────────────────────────────────────────────────────────┘
```

## 5. Question Bank

```
┌──────────────────────────────────────────────────────────────────────┐
│ Question Bank                              [+ Add Question] [Import] │
├──────────────────────────────────────────────────────────────────────┤
│ 🔍 Search questions...  Type:[All▾] Difficulty:[All▾] Topic:[All▾] │
├──────────────────────────────────────────────────────────────────────┤
│ □ │ ID      │ Question (preview)          │ Type │ Diff │ Status   │
│───┼─────────┼─────────────────────────────┼──────┼──────┼──────────│
│ □ │ Q-1234  │ If ratio of ages of A...    │ MCQ  │ Med  │ ✅ Active│
│ □ │ Q-1235  │ Write a program to find...  │ CODE │ Hard │ ✅ Active│
│ □ │ Q-1236  │ Explain the concept of...   │ SUBJ │ Hard │ ⏳ Review│
│ □ │ Q-1237  │ Listen to the audio and...  │ AUDIO│ Easy │ ✅ Active│
│ □ │ Q-1238  │ Calculate the determinant..│ NUM  │ Med  │ 📝 Draft │
│                                                                      │
│ Showing 1-20 of 12,450          [◀ 1 2 3 ... 623 ▶]              │
└──────────────────────────────────────────────────────────────────────┘
```

## 6. Analytics Dashboard

```
┌──────────────────────────────────────────────────────────────────────┐
│ Analytics > Exam: GATE 2026                    [Export PDF] [CSV]    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐   │
│  │ Score Distribution          │  │ Question Difficulty Index   │   │
│  │                             │  │                             │   │
│  │      ▄▄▄                    │  │  Q1  ████████░░ 0.82       │   │
│  │    ▄▄███▄▄                  │  │  Q2  ██████░░░░ 0.65       │   │
│  │  ▄▄███████▄▄               │  │  Q3  ████░░░░░░ 0.41       │   │
│  │ ▄███████████▄              │  │  Q4  █████████░ 0.91       │   │
│  │ 0  20  40  60  80  100     │  │  Q5  ███████░░░ 0.73       │   │
│  └─────────────────────────────┘  └─────────────────────────────┘   │
│                                                                      │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐   │
│  │ Completion Rate             │  │ Proctoring Summary          │   │
│  │                             │  │                             │   │
│  │  Started:    12,000         │  │  Clean:     10,850 (90.4%) │   │
│  │  Submitted:  11,200 (93.3%) │  │  Flagged:      980 (8.2%)  │   │
│  │  Timeout:       650 (5.4%)  │  │  Terminated:   170 (1.4%) │   │
│  │  Terminated:    150 (1.3%)  │  │                             │   │
│  └─────────────────────────────┘  └─────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## 7. Coding Assessment Interface

```
┌──────────────────────────────────────────────────────────────────────┐
│ Coding Challenge: Two Sum           ⏱ 00:45:00  Language: [Python▾]│
├────────────────────────────┬─────────────────────────────────────────┤
│ PROBLEM                    │ SOLUTION                                │
│                            │                                         │
│ Given an array of integers │  1 │ def twoSum(nums, target):         │
│ nums and an integer        │  2 │     seen = {}                      │
│ target, return indices of  │  3 │     for i, num in enumerate(nums): │
│ the two numbers such that  │  4 │         complement = target - num  │
│ they add up to target.      │  5 │         if complement in seen:    │
│                            │  6 │             return [seen[complement],│
│ Example:                   │  7 │                     i]              │
│ Input: nums=[2,7,11,15]   │  8 │         seen[num] = i              │
│        target=9            │  9 │     return []                      │
│ Output: [0,1]              │ 10 │                                    │
│                            │                                         │
│ Constraints:               │  [▶ Run]  [Submit]                      │
│ • 2 <= nums.length <= 10⁴ │                                         │
├────────────────────────────┤─────────────────────────────────────────┤
│ TEST CASES                 │ OUTPUT                                  │
│ ✅ Case 1: [2,7,11,15], 9│ > PASSED (3/3 test cases)              │
│ ✅ Case 2: [3,2,4], 6     │   Case 1: [0,1] ✓  0.02s              │
│ ✅ Case 3: [3,3], 6       │   Case 2: [1,2] ✓  0.01s              │
│ 🔒 Hidden cases: 5 more   │   Case 3: [0,1] ✓  0.01s              │
└────────────────────────────┴─────────────────────────────────────────┘
```

## Theme Configuration

```css
/* Light theme */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  --destructive: 0 84.2% 60.2%;
  --success: 142 76% 36%;
  --warning: 38 92% 50%;
  --exam-bg: 210 40% 98%;
  --risk-low: 142 76% 36%;
  --risk-medium: 38 92% 50%;
  --risk-high: 0 84% 60%;
}

/* Dark theme */
.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  --primary: 217.2 91.2% 59.8%;
  --exam-bg: 222.2 47% 11%;
}
```
