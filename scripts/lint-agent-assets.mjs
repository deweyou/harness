#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

import { validateChineseReadingAssets } from './chinese-reading-assets.mjs'

const MAX_SKILL_DESCRIPTION_BYTES = 900

function isKebabCase(s) {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(s)
}

function findSkillFiles(dir) {
  const results = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillMd = join(dir, entry.name, 'SKILL.md')
      try {
        readFileSync(skillMd)
        results.push({ path: skillMd, dirName: entry.name })
      } catch {}
    }
  } catch {}
  return results
}

function findRuleFiles(dir) {
  const results = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (entry.name === 'README.md') continue
      if (!entry.name.endsWith('.md')) continue
      results.push({ path: join(dir, entry.name), fileName: entry.name })
    }
  } catch {}
  return results
}

function findDesignFiles(dir) {
  const results = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (entry.name === 'README.md') continue
      if (!entry.name.endsWith('.md')) continue
      results.push({ path: join(dir, entry.name), fileName: entry.name })
    }
  } catch {}
  return results
}

function parseFrontmatter(path, errors) {
  const content = readFileSync(path, 'utf8')

  if (!content.startsWith('---\n')) {
    errors.push(`${path}: missing frontmatter`)
    return null
  }

  const end = content.indexOf('\n---\n', 4)
  if (end === -1) {
    errors.push(`${path}: unclosed frontmatter`)
    return null
  }

  const fmText = content.slice(4, end)
  try {
    return load(fmText)
  } catch (e) {
    errors.push(`${path}: YAML parse error: ${e.message}`)
    return null
  }
}

const skills = findSkillFiles('skills')
const rules = findRuleFiles('rules')
const designs = findDesignFiles('design')
const errors = []

errors.push(...validateChineseReadingAssets(process.cwd()))

for (const { path, dirName } of skills) {
  const fm = parseFrontmatter(path, errors)
  if (!fm) continue

  for (const field of ['name', 'description']) {
    if (!fm?.[field]) errors.push(`${path}: missing required field '${field}'`)
  }
  lintSkillDescription(path, fm?.description, errors)
  lintTags(path, fm?.tags, errors)

  if (fm?.name) {
    if (!isKebabCase(fm.name))
      errors.push(`${path}: name '${fm.name}' is not kebab-case`)
    if (fm.name !== dirName)
      errors.push(`${path}: name '${fm.name}' does not match directory '${dirName}'`)
  }

}

for (const { path, fileName } of rules) {
  const fm = parseFrontmatter(path, errors)
  if (!fm) continue

  for (const field of ['name', 'description']) {
    if (!fm?.[field]) errors.push(`${path}: missing required field '${field}'`)
  }
  lintTags(path, fm?.tags, errors)

  const expectedName = fileName.replace(/\.md$/, '')

  if (fm?.name) {
    if (!isKebabCase(fm.name))
      errors.push(`${path}: name '${fm.name}' is not kebab-case`)
    if (fm.name !== expectedName)
      errors.push(`${path}: name '${fm.name}' does not match file '${expectedName}'`)
  }

}

for (const { path, fileName } of designs) {
  const fm = parseFrontmatter(path, errors)
  if (!fm) continue

  for (const field of ['name', 'description']) {
    if (!fm?.[field]) errors.push(`${path}: missing required field '${field}'`)
  }
  lintTags(path, fm?.tags, errors)

  const expectedName = fileName.replace(/\.md$/, '')

  if (fm?.name) {
    if (!isKebabCase(fm.name))
      errors.push(`${path}: name '${fm.name}' is not kebab-case`)
    if (fm.name !== expectedName)
      errors.push(`${path}: name '${fm.name}' does not match file '${expectedName}'`)
  }
}

if (errors.length) {
  console.error('Agent asset lint errors:')
  for (const e of errors) console.error(`  ${e}`)
  process.exit(1)
} else {
  console.log(`✓ ${skills.length} SKILL.md file(s), ${rules.length} rule file(s), ${designs.length} design file(s), and all Chinese reading companions passed`)
}

function lintTags(path, tags, errors) {
  if (tags === undefined) return
  if (!Array.isArray(tags)) {
    errors.push(`${path}: tags must be an array`)
    return
  }

  for (const [index, tag] of tags.entries()) {
    if (typeof tag !== 'string' || tag.length === 0) {
      errors.push(`${path}: tags[${index}] must be a non-empty string`)
    }
  }
}

function lintSkillDescription(path, description, errors) {
  if (typeof description !== 'string') return

  const byteLength = Buffer.byteLength(description, 'utf8')
  if (byteLength > MAX_SKILL_DESCRIPTION_BYTES) {
    errors.push(
      `${path}: description is ${byteLength} bytes; keep skill descriptions at or below ${MAX_SKILL_DESCRIPTION_BYTES} bytes so agent discovery metadata stays portable`,
    )
  }
}
