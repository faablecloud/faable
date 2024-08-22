---
name: Bug report
about: Create a report to help us improve
title: '[Bug] xxxxxx'
labels: ['bug']
assignees:
 - boyander
body:
  - type: textarea
    id: bug-description
    attributes:
      label: Describe the bug
      placeholder: Tell us what you see! A clear and concise description of what the bug is.
    validations:
      required: true
  - type: textarea
    id: bug-steps
    attributes:
      label: Steps to reproduce the behavior
      placeholder: |
        1. Go to '...'
        2. Click on '....'
        3. Scroll down to '....'
        4. See error
    validations:
      required: true
  - type: textarea
    id: bug-expected
    attributes:
      label: Also tell us, what did you expect to happen?
      placeholder: A clear and concise description of what you expected to happen.
    validations:
      required: true
---


**Screenshots**
If applicable, add screenshots to help explain your problem.

**Please complete the following information:**
 - Device: [e.g. iPhone6]
 - OS: [e.g. iOS]
 - Browser [e.g. chrome, safari]
 - Version [e.g. 22]


**Additional context**
Add any other context about the problem here.
