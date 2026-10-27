"""GpxilStudio's own Python: what joins the web page to the packages.

``gpxilwb.cli`` runs the packages' command-line programs by name (the
terminal's ``gpxil``, ``gpxil2pxil`` and ``pxil``, and ``!`` lines in
notebooks), and ``gpxilwb.gui`` has the small functions the point-and-click
Tools tab calls: what a gpxil file holds, and a check against the
specification.

None of this is needed to use the packages on your own computer: there you
install them with pip (``pip install gpxiltools gpxil2pxil pxil``) and call
them directly.
"""

__version__ = "1.0.0"
