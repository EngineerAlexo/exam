# Online Examination System (HTML · CSS · JavaScript · Supabase)

## Features

| Role | What they can do |
|---|---|
| **Admin** | Generate student accounts in bulk (username + random password), reset passwords, create exams, upload questions as plain text, publish/unpublish, view results and export CSV |
| **Student** | Sign in with the given username and password, change the password on first login, see available exams, take an exam with radio buttons, see their own result |

Exam protection:
- Exam must be opened in **full-screen** (browser requires a click to enter it).
- Leaving full-screen, switching tabs, copy/paste and right-click are recorded.
- After 3 warnings (configurable) the exam is **submitted automatically**.
- Timer auto-submits when time runs out.
- Grading happens **on the server**, so correct answers are never sent to students.

---

## 1. Project structure

```
online-exam-system/
├── index.html                 Login (students + admin)
├── change-password.html       First-login password change
├── css/style.css
├── js/
│   ├── config.js              ← Supabase URL + anon key + settings
│   ├── common.js              shared helpers and route guards
│   ├── parser.js              turns "Q1. / A. / B. / Answer:" text into questions
│   ├── login.js
│   ├── change-password.js
│   ├── student.js             student dashboard
│   ├── exam.js                exam page (full-screen, timer, submit)
│   └── admin.js               admin dashboard
├── student/
│   ├── dashboard.html
│   └── exam.html
├── admin/
│   └── dashboard.html
└── supabase/
    ├── schema.sql             tables, security rules, server functions
    └── functions/create-students/index.ts   Edge Function (admin-only)
```

---

## 2. Set up Supabase (one time)

### Step A – Create the database
1. Open your project **isjfzzktnyctzmhjqhju** in Supabase.
2. Go to **SQL Editor → New query**.
3. Paste the whole of `supabase/schema.sql` and press **Run**.

### Step B – Turn off public sign-ups (important)
Authentication → **Sign In / Providers** → **Email** → turn **off** "Allow new users to sign up".
Only the admin should create accounts.

### Step C – Create the admin account
1. Authentication → **Users** → **Add user** → *Create new user*.
   - Email: `admin@yourschool.edu` (any email you control)
   - Password: a strong password
   - Tick **Auto Confirm User**.
2. Back in **SQL Editor**, run the admin block at the bottom of `schema.sql`
   (change the email to the one you used). This makes that user an admin.

### Step D – Deploy the Edge Function (creates student accounts)
Option 1 – Dashboard (no install needed):
1. Supabase → **Edge Functions** → **Deploy a new function** → name it `create-students`.
2. Replace the default code with the content of `supabase/functions/create-students/index.ts` and deploy.

Option 2 – Terminal (after `npm i -g supabase`):
```bash
supabase login
supabase link --project-ref isjfzzktnyctzmhjqhju
supabase functions deploy create-students
```

The function reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Supabase provides these automatically, so you do **not** need to type the service key anywhere in your code.

### Step E – Rotate the key you shared
The service_role key that was pasted in chat is a master key. Go to **Project Settings → API** and regenerate it. Do not paste it into any file.

---

## 3. Run the project in VS Code

1. Unzip the folder and open it in VS Code (**File → Open Folder**).
2. Open `js/config.js` and check the URL and anon key (already filled in).
3. Install the **Live Server** extension, then right-click `index.html` → **Open with Live Server**.
   (Any static server works, for example `npx serve .`.)
4. Open the address shown (for example `http://127.0.0.1:5500`).

---

## 4. How to use it

### Admin
1. Sign in with the admin email.
2. **1 · Students** → enter a prefix (for example `cs26`), a start number and how many → **Generate accounts**.
   Or paste full names, one per line.
3. **Download CSV** or **Print** the credentials right away. Passwords are shown only once.
4. **2 · Exams** → create an exam (duration, pass mark, optional open/close times, publish checkbox).
5. **3 · Questions** → choose the exam, paste questions in this format and click **Preview**, then **Save questions**:

```
Q1. What is the SI unit of force?
A. Joule
B. Newton
C. Watt
D. Pascal
Answer: B

Q2. Which quantity is a scalar?
A. Velocity
B. Force
C. Mass
D. Displacement
Answer: C
```

6. **4 · Results** → choose an exam to see scores, pass/fail, warnings and export CSV.

### Student
1. Open the link, sign in with the username and password from the admin.
2. Set a new password (at least 8 characters).
3. On the dashboard, press **Start exam**, then **Enter full-screen**.
4. Choose one radio button per question and press **Submit**.

---

## 5. Limits you should know about

- A web page **cannot fully block** the operating system. Alt+Tab, a phone camera, or a second device can still be used. The system records what the browser can detect. For high-stakes exams, combine it with invigilation.
- Browsers require a click to enter full-screen, so the student must press the button.
- Passwords generated by the admin are not stored anywhere. Download or print the list right away, or use **Reset password** later.
- Keep the anon key public, but never put the service_role key in any frontend file.
