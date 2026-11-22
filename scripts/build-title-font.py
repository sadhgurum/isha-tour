"""Extend Custom Hand and export the tour's self-hosted title font.

Requires fonttools and brotli. Run from any directory with the path to the
original CustomHand-Regular.ttf (or its WOFF2 equivalent) as the argument.
"""

import math
from pathlib import Path
import sys
import unicodedata

from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


# Reuse outlines for letters shared by both alphabets.
SHARED = dict(zip(
    "АВЕКМНОРСТУХаеорсухјІіЅѕЈ",
    "ABEKMHOPCTYXaeopcyxjIiSsJ",
))

# Each stroke lists pen positions in font units. A third coordinate sets the
# stroke width at that point. Shapes are drawn upright to match Custom Hand.
# Stroke directions and widths give each form the variation of a broad pen.
CAPITALS = {
    "Б": (640, "548,660,37 329,674 111,659,68 104,339 96,45,57 / 108,367,65 277,386 445,353 546,275 558,183 482,89 312,43 112,27,34"),
    "Г": (564, "489,650,33 308,668 113,658,80 107,357 94,42,34"),
    "Д": (748, "138,58,66 242,222 329,499 388,651,67 539,657 575,378 593,67,55 / 88,-124,33 81,40,61 362,49 647,52,71 661,-116,31"),
    "Ж": (846, "419,662,69 424,364 407,27,39 / 108,650,63 224,483 393,360,63 208,214 80,43,38 / 737,657,67 627,477 438,360,58 621,242 761,44,42"),
    "З": (587, "92,556,47 198,649 372,667 473,605 483,517 394,427 273,388,49 411,379 495,300 504,203 421,99 269,48 87,79,39"),
    "И": (703, "105,649,67 109,352 105,57,46 357,318 579,653,68 585,357 580,46,38"),
    "Л": (698, "71,38,33 207,160 297,434 394,654,72 507,654 551,377 598,40,41"),
    "П": (680, "103,38,46 107,313 111,657,75 328,674 555,650,67 566,342 557,46,44"),
    "Ф": (825, "408,672,54 412,360 401,24,43 / 411,545,45 248,528 131,448 104,345 156,243 262,187 424,188 585,222 696,310 712,417 599,507 427,541,49"),
    "Ц": (702, "112,653,69 101,335 111,65,58 335,40 545,51,72 562,350 561,655,65 / 545,53,58 642,53,66 630,-128,29"),
    "Ч": (652, "107,659,69 100,486 151,383 280,347 505,393,32 / 520,661,65 522,338 512,35,44"),
    "Ш": (844, "112,658,68 105,338 111,62,54 411,44 717,55,61 726,338 732,664,69 / 410,642,64 411,333 410,53,48"),
    "Щ": (933, "112,658,68 105,338 111,62,54 411,44 717,55,61 726,338 732,664,69 / 410,642,64 411,333 410,53,48 / 719,54,55 854,56,74 840,-124,30"),
    "Ъ": (721, "81,648,32 209,663 268,652,76 258,354 247,40,53 / 259,346,61 444,366 578,316 622,220 588,129 457,59 250,37,32"),
    "Ы": (845, "108,658,64 106,347 96,39,52 / 109,341,61 292,361 424,313 469,215 429,118 286,57 100,37,32 / 727,668,70 721,330 724,38,46"),
    "Ь": (595, "109,659,70 106,349 96,40,54 / 109,347,64 296,366 426,314 484,221 436,125 296,56 100,37,32"),
    "Э": (659, "98,581,38 253,659 435,656 537,565 576,398 556,238 462,112 294,47 104,90,36 / 257,363,39 413,368 565,369,64"),
    "Ю": (1010, "107,656,69 98,348 99,36,42 / 112,346,52 264,360 382,358,61 / 692,660,50 544,635 435,532 378,372 398,208 502,83 659,46 807,94 900,225 914,397 848,553 695,662,49"),
    "Я": (617, "496,32,40 497,361 515,653,69 313,667 158,618 109,520 152,418 280,366 490,364,58 / 329,360,53 211,204 76,44,40"),
    "Є": (669, "567,593,39 413,661 250,644 127,540 83,383 107,221 225,100 390,46 568,107,37 / 99,348,58 244,356 411,359,38"),
    "Њ": (872, "105,655,67 103,344 98,38,43 / 105,350,59 291,350 468,357,53 / 471,653,65 467,345 461,41,57 / 473,350,65 625,364 750,307 788,224 747,125 620,65 465,39,33"),
    "Љ": (865, "70,39,32 188,164 279,434 374,652,69 478,651 500,348 496,37,47 / 503,348,61 637,360 752,308 781,220 741,128 634,61 495,38,33"),
    "Џ": (655, "110,658,67 102,340 111,65,57 330,43 527,57,68 541,350 537,659,64 / 332,51,62 336,-128,35"),
    "Ґ": (575, "492,741,31 488,656,42 324,668 113,658,80 107,357 94,42,34"),
    "Ћ": (645, "106,653,62 103,350 96,43,37 / 57,545,34 227,555 409,547,42 / 108,321,47 266,387 418,362 512,271 525,40,42"),
    "Ђ": (636, "109,651,62 107,346 96,44,38 / 55,544,35 232,553 420,546,41 / 110,314,47 270,390 419,358 506,269 519,47 464,-96 377,-146,34"),
    "Ң": (707, "110,654,65 108,346 101,45,43 / 565,659,68 562,362 558,48,55 638,50,58 629,-122,29 / 114,351,50 336,363 552,353,56"),
}

LOWERCASE = {
    "б": (563, "474,681,37 340,635 212,590 137,506 110,388 101,218 152,104 273,54 406,83 480,181 470,303 372,371 249,370 120,305,43"),
    "в": (505, "107,31,37 103,207 105,394,57 255,410 373,369 393,306 329,239 127,216,48 / 130,218,52 283,227 404,189 426,119 340,57 108,35,32"),
    "г": (426, "355,389,36 223,405 110,393,64 105,209 97,37,36"),
    "д": (570, "123,62,57 208,176 274,347 335,396,63 408,394 433,208 446,56,49 / 77,-92,29 77,45,52 270,50 483,48,60 491,-92,29"),
    "ж": (656, "331,394,60 332,217 323,35,38 / 94,392,51 192,280 314,221,48 187,134 71,38,35 / 569,398,56 472,272 347,221,51 475,140 585,38,35"),
    "з": (449, "85,343,35 191,400 310,394 368,336 338,267 233,222,41 339,215 378,159 347,91 244,46 86,72,35"),
    "и": (538, "103,389,57 104,225 100,47,49 267,184 415,385,59 424,215 419,41,36"),
    "к": (467, "101,387,54 105,206 96,38,38 / 377,391,48 264,278 112,209,51 261,162 405,40,37"),
    "л": (555, "70,37,33 170,118 247,307 321,397,58 411,394 442,199 467,38,35"),
    "м": (673, "104,38,39 109,204 120,394,57 225,315 331,194,46 441,317 539,399,56 558,206 563,39,40"),
    "н": (518, "102,395,56 99,201 97,34,38 / 412,397,55 411,208 411,40,38 / 106,208,41 266,216 408,211,51"),
    "п": (525, "102,35,39 106,213 108,390,60 260,403 416,391,55 426,212 416,37,37"),
    "т": (463, "75,381,36 236,398 392,385,43 / 240,389,55 237,200 224,39,35"),
    "ф": (608, "307,622,51 311,252 306,-158,34 / 309,382,47 161,361 86,287 84,177 163,86 308,68 454,94 526,183 516,292 441,365 314,385,44"),
    "ц": (570, "102,393,58 103,227 108,56,52 254,48 415,51,59 419,217 420,394,55 / 417,53,46 500,54,57 493,-96,30"),
    "ч": (488, "99,393,58 97,278 152,220 244,204 379,232,32 / 389,394,56 388,209 385,37,39"),
    "ш": (703, "103,393,59 102,228 106,56,52 340,44 584,52,59 599,234 598,398,55 / 349,384,55 344,213 343,50,47"),
    "щ": (784, "103,393,59 102,228 106,56,52 340,44 584,52,59 599,234 598,398,55 / 349,384,55 344,213 343,50,47 / 585,52,49 707,54,57 696,-99,31"),
    "ъ": (551, "74,388,32 208,398,58 204,207 196,41,45 / 206,211,53 329,238 438,199 467,138 415,73 316,45 198,40,34"),
    "ы": (670, "98,393,57 98,218 96,42,48 / 103,219,52 237,238 352,200 389,138 330,72 233,47 99,39,35 / 565,399,57 560,222 560,37,37"),
    "ь": (473, "102,392,57 103,214 96,39,47 / 106,217,54 229,239 352,205 387,142 336,75 228,46 100,38,34"),
    "э": (523, "79,348,32 198,405 324,389 414,308 443,198 397,104 284,51 166,55 77,104,32 / 191,220,34 307,225 427,220,51"),
    "ю": (765, "102,392,56 99,220 99,35,39 / 109,218,47 213,224 289,222,45 / 481,403,45 361,376 293,302 280,199 334,94 446,51 577,57 658,129 682,229 641,332 547,396 479,404,44"),
    "я": (513, "413,38,38 415,216 420,385,58 285,400 171,375 109,314 128,246 227,211 406,215,51 / 249,213,47 168,126 76,38,36"),
    "є": (527, "451,356,33 336,403 210,386 113,305 86,197 137,103 246,53 364,56 451,101,33 / 105,219,48 229,223 347,224,31"),
    "њ": (713, "103,396,58 105,219 99,39,37 / 112,216,48 255,225 382,219,51 / 390,396,58 388,218 386,40,48 / 392,219,56 504,238 596,197 623,139 573,78 493,46 388,37,33"),
    "љ": (717, "69,38,33 158,113 221,293 287,397,58 365,397 390,215 382,40,46 / 394,213,51 508,233 597,199 625,138 572,77 491,46 385,37,32"),
    "џ": (526, "104,397,57 104,224 111,61,51 256,45 407,56,59 420,226 417,394,58 / 257,51,57 259,-100,33"),
    "ґ": (433, "358,461,29 356,393,44 225,405 109,393,60 105,210 97,38,35"),
    "ө": (566, "286,401,39 159,375 90,291 85,188 145,94 266,52 389,68 470,137 487,243 443,338 342,397 284,402,39 / 98,222,42 283,224 475,223,43"),
    "ћ": (539, "101,626,54 103,318 96,39,38 / 59,518,32 198,527 347,519,37 / 109,290,43 235,357 360,336 426,247 437,38,38"),
    "ђ": (522, "103,626,55 104,322 96,39,37 / 58,517,32 195,526 339,517,37 / 111,290,42 241,359 361,333 431,239 434,37 381,-90 300,-137,31"),
    "ң": (574, "102,395,56 99,201 97,34,38 / 412,397,55 411,208 410,45,49 497,46,51 485,-92,28 / 106,208,41 266,216 408,211,51"),
}

ACCENTS = {
    "\u0300": ("-82,139,52 -17,74 41,32,27",),
    "\u0301": ("70,145,52 24,75 -28,32,28",),
    "\u0302": ("-103,34,37 0,144,52 107,30,33",),
    "\u0303": ("-126,55,34 -74,109,44 -5,100 61,70 123,113,36",),
    "\u0304": ("-117,75,41 4,81 117,72,37",),
    "\u0306": ("-109,130,36 -65,60 3,43 69,64 119,131,38",),
    "\u0307": ("0,79,59 11,101,49",),
    "\u0308": ("-85,75,58 -79,94,48", "80,78,56 88,98,46"),
    "\u0309": ("-50,119,31 5,155 57,132 61,94 10,66 0,35,31",),
    "\u030a": ("0,145,32 -55,113 -48,52 5,33 55,71 49,124 2,145,31",),
    "\u030b": ("-40,137,49 -72,80 -114,40,26", "102,141,48 66,79 21,39,26"),
    "\u030c": ("-108,135,35 -5,38,47 109,131,33",),
    "\u031b": ("-15,-49,33 35,-25 44,28,42",),
    "\u0323": ("0,-112,56 9,-94,47",),
    "\u0326": ("28,-79,48 7,-127 -35,-167,27",),
    "\u0327": ("-4,-8,32 -23,-73 24,-94 22,-134 -31,-159 -73,-154,29",),
    "\u0328": ("39,-12,37 -20,-67 -48,-120 -5,-158 53,-139,29",),
}


def smoothed_points(points):
    """Sample a Catmull–Rom centerline through the pen positions."""
    padded = [points[0], *points, points[-1]]
    for start in range(len(points) - 1):
        a, b, c, d = padded[start:start + 4]
        for step in range(8):
            t = step / 8
            yield tuple(
                0.5 * ((2 * v) + (-u + w) * t
                       + (2 * u - 5 * v + 4 * w - z) * t**2
                       + (-u + 3 * v - 3 * w + z) * t**3)
                for u, v, w, z in zip(a, b, c, d)
            )
    yield points[-1]


def draw_stroke(pen, stroke):
    positions = [tuple(map(int, point.split(","))) for point in stroke.split()]
    points = list(smoothed_points([
        (x, y, *width) if width else (x, y, 53) for x, y, *width in positions
    ]))
    left, right = [], []
    nib = []
    for index, (x, y, width) in enumerate(points):
        before = points[max(0, index - 1)]
        after = points[min(len(points) - 1, index + 1)]
        angle = math.atan2(after[1] - before[1], after[0] - before[0])
        radius = width * (0.63 + 0.16 * math.sin(angle + math.pi / 6)**2)
        nib.append((x, y, radius))
        nx, ny = -math.sin(angle) * radius, math.cos(angle) * radius
        left.append((x + nx, y + ny))
        right.append((x - nx, y - ny))

    def cap(point, angle, start):
        x, y, radius = point
        span = [angle + start - math.pi * n / 5 for n in range(1, 5)]
        return [(x + radius * math.cos(a), y + radius * math.sin(a)) for a in span]

    first = math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0])
    last = math.atan2(points[-1][1] - points[-2][1], points[-1][0] - points[-2][0])
    outline = left + cap(nib[-1], last, math.pi / 2) + right[::-1] + cap(nib[0], first, -math.pi / 2)
    vertices = [(round(x), round(y)) for x, y in outline]
    pen.moveTo(vertices[0])
    for vertex in vertices[1:]:
        pen.lineTo(vertex)
    pen.closePath()


def extend_font(font):
    glyphs = font["glyf"]
    metrics = font["hmtx"]
    glyph_order = font.getGlyphOrder()
    cmap = font.getBestCmap()
    unicode_tables = [table for table in font["cmap"].tables if table.isUnicode()]

    def map_letter(letter, glyph_name):
        for table in unicode_tables:
            table.cmap[ord(letter)] = glyph_name

    def add_glyph(letter, pen, width):
        if letter:
            name = cmap.get(ord(letter), f"uni{ord(letter):04X}")
        else:
            name = f"accent{len(glyph_order)}"
        if name not in glyphs:
            glyph_order.append(name)
        glyphs[name] = pen.glyph()
        glyphs[name].recalcBounds(glyphs)
        metrics[name] = (width, glyphs[name].xMin)
        if letter:
            map_letter(letter, name)
        return name

    def draw_letter(letter, width, strokes):
        pen = TTGlyphPen(None)
        for stroke in strokes.split(" / "):
            draw_stroke(pen, stroke)
        add_glyph(letter, pen, width)

    for letter, latin in SHARED.items():
        map_letter(letter, cmap[ord(latin)])

    for letter, (width, strokes) in {**CAPITALS, **LOWERCASE}.items():
        draw_letter(letter, width, strokes)

    # A clearer lowercase w at the tour's small heading sizes.
    draw_letter("w", 676, "94,376,63 133,222,67 204,49,53 271,143,52 343,329,47 399,197,53 465,48,55 541,175,54 584,378,36")

    # Give m two arches at the height of n, with open spaces between the stems.
    pen = TTGlyphPen(None)
    pen.moveTo((64, 18))
    pen.qCurveTo((52, 145), (68, 373))
    pen.qCurveTo((75, 414), (123, 400))
    pen.qCurveTo((145, 390), (142, 356))
    pen.lineTo((135, 275))
    pen.qCurveTo((190, 395), (289, 397))
    pen.qCurveTo((382, 408), (417, 264))
    pen.qCurveTo((482, 394), (581, 391))
    pen.qCurveTo((710, 386), (744, 193))
    pen.qCurveTo((774, 21), (742, 0))
    pen.qCurveTo((724, -9), (704, 47))
    pen.qCurveTo((644, 319), (570, 320))
    pen.qCurveTo((491, 323), (443, 146))
    pen.qCurveTo((430, 94), (420, 38))
    pen.qCurveTo((412, 8), (389, 9))
    pen.qCurveTo((368, 12), (365, 52))
    pen.qCurveTo((362, 181), (335, 266))
    pen.qCurveTo((317, 332), (280, 326))
    pen.qCurveTo((207, 321), (162, 175))
    pen.qCurveTo((134, 92), (121, 45))
    pen.qCurveTo((104, -12), (78, -5))
    pen.qCurveTo((68, -3), (64, 18))
    pen.closePath()
    add_glyph("m", pen, 821)

    # Round out p's bowl and join it to a continuous descender.
    pen = TTGlyphPen(None)
    pen.moveTo((70, -188))
    pen.qCurveTo((64, 124), (81, 390))
    pen.qCurveTo((90, 430), (133, 421))
    pen.qCurveTo((159, 414), (154, 367))
    pen.qCurveTo((224, 418), (304, 408))
    pen.qCurveTo((450, 400), (462, 270))
    pen.qCurveTo((478, 134), (372, 67))
    pen.qCurveTo((267, -2), (145, 40))
    pen.qCurveTo((134, -91), (126, -194))
    pen.qCurveTo((123, -233), (97, -233))
    pen.qCurveTo((75, -230), (70, -188))
    pen.closePath()
    pen.moveTo((148, 109))
    pen.qCurveTo((250, 74), (334, 131))
    pen.qCurveTo((401, 177), (393, 259))
    pen.qCurveTo((384, 341), (298, 345))
    pen.qCurveTo((210, 352), (152, 291))
    pen.qCurveTo((146, 201), (148, 109))
    pen.closePath()
    add_glyph("p", pen, 515)

    # A few extra forms that borrow the new Cyrillic strokes or Latin shapes.
    for target, source, scale in [
        ("Ө", "ө", 1.55),
        ("Ү", "Y", 1), ("ү", "Y", 0.66), ("һ", "h", 1),
    ]:
        base = cmap[ord(source)]
        pen = TTGlyphPen(glyphs)
        pen.addComponent(base, (scale, 0, 0, scale, 0, 0))
        add_glyph(target, pen, round(metrics[base][0] * scale))

    draw_letter("æ", 785, "427,296,58 346,399 211,389 111,303 84,178 134,78 254,69 414,215,60 / 696,117,37 573,51 459,68 420,151 432,253 520,371 639,397 701,341 669,266 550,207 436,203,46")
    draw_letter("þ", 545, "110,627,55 105,204 100,-151,37 / 109,333,43 241,401 376,380 457,311 458,207 389,130 276,102 110,143,38")
    draw_letter("ß", 543, "103,36,39 104,334 127,502 211,620 350,649 417,583 390,502 264,402 230,355,50 363,327 437,245 411,133 310,61 195,75,38")
    draw_letter("ð", 570, "150,640,35 283,583 399,482 466,347 466,206 402,93 268,55 147,99 91,199 118,310 207,376 321,384 447,326,40 / 207,475,34 323,524 424,568,39")
    draw_letter("ı", 225, "115,392,58 105,228 106,39,41")
    draw_letter("ə", 541, "95,338,37 235,402 362,375 443,293 448,174 386,78 270,51 155,69 103,141 110,215 258,224 437,218,48")
    draw_letter("Ə", 766, "116,575,39 271,654 454,652 602,569 683,424 678,263 594,128 434,53 267,54 133,139 93,266 111,346,58 372,354 672,350,48")
    draw_letter("Þ", 630, "111,664,65 110,346 104,43,43 / 112,500,54 311,521 456,467 532,384 523,290 424,212 278,187 114,210,37")
    for letter, base, stroke in (
        ("Đ", "D", "38,346,43 182,350 326,341,36"),
        ("đ", "d", "147,519,35 290,525 434,519,38"),
        ("Ł", "L", "35,315,38 151,367 263,428,40"),
        ("ł", "l", "31,315,36 110,357 191,405,36"),
        ("Ø", "O", "77,4,34 407,353 744,688,34"),
        ("ø", "o", "53,-33,27 288,228 502,459,29"),
    ):
        pen = TTGlyphPen(glyphs)
        pen.addComponent(cmap[ord(base)], (1, 0, 0, 1, 0, 0))
        accent = TTGlyphPen(None)
        draw_stroke(accent, stroke)
        name = add_glyph(None, accent, 0)
        pen.addComponent(name, (1, 0, 0, 1, 0, 0))
        add_glyph(letter, pen, metrics[cmap[ord(base)]][0])

    # Use the same accent outlines for Latin extensions and Cyrillic accents.
    accents = {}
    for mark, strokes in ACCENTS.items():
        pen = TTGlyphPen(None)
        for stroke in strokes:
            draw_stroke(pen, stroke)
        accents[mark] = add_glyph(None, pen, 0)

    for code in [*range(0xC0, 0x250), *range(0x400, 0x500), *range(0x1E00, 0x1F00)]:
        if code in cmap:
            continue
        letter = chr(code)
        base, *marks = unicodedata.normalize("NFD", letter)
        if not marks or ord(base) not in cmap or any(mark not in accents for mark in marks):
            continue
        if base in "iі" and any(unicodedata.combining(mark) == 230 for mark in marks):
            base = "ı"
        base_name = cmap[ord(base)]
        pen = TTGlyphPen(glyphs)
        pen.addComponent(base_name, (1, 0, 0, 1, 0, 0))
        bounds = glyphs[base_name]
        top = bounds.yMax
        for mark in marks:
            center = round((bounds.xMin + bounds.xMax) / 2)
            if mark == "\u031b":
                center = bounds.xMax - 12
                y = min(400, top - 30)
            elif unicodedata.combining(mark) in {202, 220}:
                y = min(0, bounds.yMin)
            else:
                y = top + 22
                top = y + glyphs[accents[mark]].yMax
                # On a stacked accent, shift the outer mark beside the roof.
                if top > 1010:
                    center += 125
                    y -= 110
            pen.addComponent(accents[mark], (1, 0, 0, 1, center, y))
        add_glyph(letter, pen, metrics[base_name][0])

    font.setGlyphOrder(glyph_order)
    font["OS/2"].recalcUnicodeRanges(font)
    font["OS/2"].usWinAscent = max(glyphs[name].yMax for name in cmap.values() if name != "space")
    font["OS/2"].usWinDescent = max(font["OS/2"].usWinDescent, -min(
        glyphs[name].yMin for name in cmap.values() if name != "space"
    ))
    for name_id, value in {
        1: "Isha Tour Hand", 3: "IshaTourHand-Regular 1.0", 4: "Isha Tour Hand",
        5: "Version 1.0", 6: "IshaTourHand-Regular",
    }.items():
        for record in font["name"].names:
            if record.nameID == name_id:
                record.string = value


if __name__ == "__main__":
    font = TTFont(sys.argv[1], recalcTimestamp=False)
    extend_font(font)
    font.flavor = "woff2"
    font.save(Path(__file__).resolve().parents[1] / "src/fonts/IshaTourHand-Regular.woff2")
