# Data Protection Notice Template

Last updated: 2026-02-08
Scope: Instance-level notice text for Sanctum operators

Use this template as a starting point for the notice you display to end users.
Edit for your jurisdiction, infrastructure, and actual data practices.

## 1. Operator Responsibility Notice (Short Form)

Suggested in-product text:

> This Sanctum instance is operated by [Organization/Admin Name].  
> Data collection, encryption settings, AI sharing settings, and retention are configured by this instance administrator.  
> Some fields may be stored in plaintext or shared with AI services if enabled by this administrator.

## 2. Recommended Full Notice (Long Form)

Suggested policy text:

1. **Who operates this instance**
   [Organization/Admin Name] operates this Sanctum deployment and is responsible for decisions about what data is collected and how it is processed.

2. **What data is collected**
   We collect account and profile data that users submit, plus usage and operational metadata needed to run the service.

3. **Encryption and plaintext configuration**
   Sanctum supports encrypted profile fields by default, but field-level settings are controlled by the instance administrator.
   Depending on configuration, some fields may be stored in plaintext.

4. **AI and third-party processing**
   If enabled, certain data may be sent to configured AI or infrastructure providers to deliver features.
   The enabled providers and settings are controlled by this instance administrator.

5. **Data retention and deletion**
   [Describe retention periods and deletion workflow.]

6. **User rights and requests**
   For access, correction, deletion, or compliance inquiries, contact: [Contact Email/Method].

7. **Legal basis and consent (where required)**
   [Describe legal basis and when/where consent is collected.]

## 3. Admin UI Warning Copy (Field Configuration)

Suggested confirmation text for risky field settings:

> I confirm this field can be stored in plaintext and/or shared with AI under our applicable legal requirements.

> Enable this only after updating user notices, consent flows (if required), and internal data-handling policies.

## 4. Notes

- This template is not legal advice.
- Have counsel review final wording for your jurisdiction and use case.
